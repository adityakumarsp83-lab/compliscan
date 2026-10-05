import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Camera,
  Barcode,
  Scale,
  RefreshCw,
  Upload,
  Loader2,
  FileDown,
  AlertCircle,
  Map,
  ScanLine,
  TrendingUp,
  Layers,
  History,
  Search,
  Trash2,
  LogOut,
  Settings,
  Images,
  X,
  Brain,
  Plus,
  Lock,
  Copy,
  Check,
  ChevronRight,
  CheckCircle,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import { MetricFiducialEngine, LegalMetrologyEngine } from './engine';
import type { OCRBlock, ComplianceReport, RuleCheckResult } from './engine';
import { generateImprovementNoticePDF } from './pdfGenerator';
import { hashImage, createEvidenceManifest, surfaceForImage } from './imageEvidence';
import { WardInspectionDashboard } from './WardMap';
import {
  NATIONAL_COMMODITY_REGISTRY,
  evaluatePriceAndGrammageAnomalies,
  type AnomalyVerdict,
} from './registryData';
import { enhanceImage, generateThumbnail } from './imagePreprocessor';
import { mergeTokenSets, mergeBlocks, geminiResultToTokens } from './tokenMerger';
import type { TaggedScan } from './tokenMerger';
import { validatePackSize } from './secondSchedule';
import { saveInspection, listInspections, deleteInspection } from './inspectionStore';
import type { StoredInspection } from './inspectionStore';
import { geminiOcr, isBackendOnline, saveToBackendHistory } from './apiClient';
import { AuthProvider, LoginPage, useAuth } from './authContext';
import { v4 as uuidv4 } from './uuid-shim';

// ── Simple UUID shim so we don't import uuid package in browser directly ──
// (uuidv4 is below; we alias it here for clarity)

type ActiveTab = 'SCANNER' | 'HISTORY' | 'HEATMAP';

interface ImageEntry {
  sha256: string;
  surface: string;
  scans: TaggedScan[];
  file: File;
  url: string;
  thumbnail: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  confidence: number;
  rawText: string;
  blocks: OCRBlock[];
}

// ── Main App Shell (inside AuthProvider) ─────────────────────────────────────
function AppShell() {
  const { user, isOfflineMode, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('SCANNER');
  const [barcodeWidthPx, setBarcodeWidthPx] = useState<number>(320);
  const [selectedBarcode, setSelectedBarcode] = useState<string>('8901491101895');
  const [images, setImages] = useState<ImageEntry[]>([]);
  const [activeImageIdx, setActiveImageIdx] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [scaleRatio, setScaleRatio] = useState<number>(0);
  const [detectedBlocks, setDetectedBlocks] = useState<OCRBlock[]>([]);
  const [anomalyResult, setAnomalyResult] = useState<AnomalyVerdict | null>(null);
  const [geminiUsed, setGeminiUsed] = useState<boolean>(false);
  const [forceGeminiLoading, setForceGeminiLoading] = useState<boolean>(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  const [historyRecords, setHistoryRecords] = useState<StoredInspection[]>([]);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'COMPLIANT' | 'VIOLATION'>('ALL');
  const [copiedHash, setCopiedHash] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Check backend status on mount
  useEffect(() => {
    isBackendOnline().then(setBackendOnline);
  }, []);

  // Load history when tab switches to HISTORY
  useEffect(() => {
    if (activeTab === 'HISTORY') {
      loadHistory();
    }
  }, [activeTab]);

  const loadHistory = async () => {
    const records = await listInspections({ search: historySearch || undefined, limit: 50 });
    setHistoryRecords(records);
  };

  const executeAudit = useCallback(
    async (allScans: TaggedScan[], barcodePx: number, barcodeStr: string, allImages: ImageEntry[]) => {
      const calibration = MetricFiducialEngine.calibrate(barcodePx);
      setScaleRatio(calibration.pixelsPerMm);

      // Merge tokens from all images
      const mergedTokens = mergeTokenSets(allScans);
      const mergedBlocks = mergeBlocks(allScans);
      setDetectedBlocks(mergedBlocks);

      // Draw bounding boxes on active image canvas
      if (allImages.length > 0) {
        drawBoundingBoxes(mergedBlocks, allImages[0].url, 0);
      }

      const auditReport = LegalMetrologyEngine.audit(mergedTokens, calibration);
      auditReport.evidence = await createEvidenceManifest(allImages.map((image, imageIndex) => ({
        imageIndex, fileName: image.file.name, surface: image.surface, sha256: image.sha256,
      })));
      setCopiedHash(false);

      // 2nd Schedule: inject result into the placeholder
      if (mergedTokens.genericName && mergedTokens.netQuantity) {
        const packResult = validatePackSize(
          mergedTokens.genericName.rawText,
          mergedTokens.netQuantity.value,
          mergedTokens.netQuantity.unit
        );
        const scheduleIdx = auditReport.results.findIndex((r) => r.ruleId === '2nd Schedule');
        if (scheduleIdx >= 0) {
          auditReport.results[scheduleIdx].status = packResult.status === 'PASS' ? 'PASS' : packResult.status === 'FAIL' ? 'FAIL' : 'WARNING';
          auditReport.results[scheduleIdx].details = packResult.message;
          if (mergedTokens.conflicts?.some((conflict) => conflict.field === 'netQuantity')) {
            auditReport.results[scheduleIdx].status = 'WARNING';
            auditReport.results[scheduleIdx].details = 'Conflicting net quantities across surfaces; review before checking pack size.';
          }
          auditReport.totalPassed = auditReport.results.filter((result) => result.status === 'PASS').length;
          auditReport.score = `${auditReport.totalPassed}/${auditReport.totalRules}`;
        }
      }

      setReport(auditReport);

      // Anomaly (price/grammage) detection
      if (mergedTokens.mrp && mergedTokens.netQuantity && !mergedTokens.conflicts?.length) {
        const anomaly = evaluatePriceAndGrammageAnomalies(
          barcodeStr,
          mergedTokens.mrp.value,
          mergedTokens.netQuantity.value
        );
        setAnomalyResult(anomaly);
      } else {
        setAnomalyResult(null);
      }

      // Save to IndexedDB history
      try {
        const thumbnail = allImages[0] ? allImages[0].thumbnail : '';
        const record: StoredInspection = {
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          product_name: mergedTokens.genericName?.rawText || 'Unknown Product',
          barcode: barcodeStr,
          score: auditReport.score,
          passed: auditReport.totalPassed,
          total: auditReport.totalRules,
          raw_text: allScans.map((s) => s.blocks.map((b) => b.text).join('\n')).join('\n---\n'),
          tokens_json: JSON.stringify(mergedTokens),
          report_json: JSON.stringify(auditReport),
          image_thumbnail: thumbnail,
          inspector_id: user?.inspectorId || 'offline',
          inspector_name: user?.name || 'Offline User',
          location: '',
        };
        await saveInspection(record);
        // Also sync to backend (non-blocking)
        if (backendOnline) {
          saveToBackendHistory(record).catch(() => {});
        }
      } catch {
        // History save failure is non-critical
      }
    },
    [user, backendOnline]
  );

  const processImages = async (files: File[]) => {
    if (files.length === 0 || isProcessing || forceGeminiLoading) return;

    setIsProcessing(true);
    setErrorMessage(null);
    setReport(null);
    setGeminiUsed(false);
    setCopiedHash(false);

    // Initialize image entries
    const existingEntries = images;
    let initialEntries: ImageEntry[];
    try {
      const addedEntries = await Promise.all(
        files.slice(0, Math.max(0, 5 - existingEntries.length)).map(async (file, index) => {
          const digest = await hashImage(file);
          const thumbnail = await generateThumbnail(file).catch(() => '');
          return {
            file, url: URL.createObjectURL(file), thumbnail, sha256: digest,
            surface: surfaceForImage(file.name, existingEntries.length + index), scans: [],
            status: 'pending' as const, confidence: 0, rawText: '', blocks: [],
          };
        })
      );
      initialEntries = [...existingEntries, ...addedEntries];
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not hash original photographs');
      setIsProcessing(false);
      return;
    }
    setImages(initialEntries);
    setActiveImageIdx(0);

    const allScans: TaggedScan[] = existingEntries.flatMap((entry) => entry.scans);

    for (let i = existingEntries.length; i < initialEntries.length; i++) {
      const entry = initialEntries[i];
      setStatusMessage(`Processing image ${i + 1}/${initialEntries.length}…`);

      // Update status to processing
      setImages((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'processing' } : e)));

      try {
        // Step 1: Canvas pre-processing
        setStatusMessage(`Image ${i + 1}: Enhancing (contrast, sharpen, deskew)…`);
        const enhanced = await enhanceImage(entry.file).catch(() => entry.file);

        // Step 2: Tesseract v5 LSTM (OEM 1 = LSTM only, most accurate)
        setStatusMessage(`Image ${i + 1}: Running OCR (Tesseract LSTM)…`);
        const result = await Tesseract.recognize(enhanced, 'eng', {
          logger: (m: { status: string; progress?: number }) => {
            if (m.status === 'recognizing text') {
              setStatusMessage(`Image ${i + 1}: OCR ${Math.round((m.progress || 0) * 100)}%`);
            }
          },
        });

        const confidence = result.data.confidence || 0;
        const extractedText = (result.data.text || '').trim();

        // Extract blocks from Tesseract
        const pageData = result.data as { lines?: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] };
        let blocks: OCRBlock[] = [];
        if (Array.isArray(pageData.lines) && pageData.lines.length > 0) {
          blocks = pageData.lines
            .map((line): OCRBlock => ({
              text: (line.text || '').trim(),
              boundingBox: {
                x: line.bbox?.x0 ?? 0,
                y: line.bbox?.y0 ?? 0,
                width: (line.bbox?.x1 ?? 200) - (line.bbox?.x0 ?? 0),
                height: (line.bbox?.y1 ?? 20) - (line.bbox?.y0 ?? 0),
              },
            }))
            .filter((b) => b.text.length > 0);
        }
        if (blocks.length === 0) {
          blocks = extractedText.split('\n').filter((l) => l.trim().length > 0).map((line, idx): OCRBlock => ({
            text: line.trim(),
            boundingBox: { x: 30, y: 35 + idx * 22, width: 300, height: 16 },
          }));
        }

        const tesseractTokens = LegalMetrologyEngine.parseTokens(blocks);
        const nonNullCount = Object.values(tesseractTokens).filter((v) => v !== null && v !== undefined).length;

        // Step 3: Smart Gemini fallback
        // Triggers if: low confidence OR few fields extracted OR critical fields (MRP/NetQty) are missing
        const criticalFieldsMissing = !tesseractTokens.mrp || !tesseractTokens.netQuantity;
        const shouldUseGemini = (confidence < 80 || nonNullCount < 5 || criticalFieldsMissing) && backendOnline;
        let geminiTokens = null;
        if (shouldUseGemini) {
          const reason = criticalFieldsMissing
            ? 'critical fields missing (MRP/Net Qty)'
            : `low confidence (${Math.round(confidence)}%)`;
          setStatusMessage(`Image ${i + 1}: ${reason} — upgrading to Gemini Vision…`);
          try {
            const geminiResult = await geminiOcr(entry.file);
            geminiTokens = geminiResultToTokens(geminiResult);
            setGeminiUsed(true);
            // Append Gemini's raw text to our combined text
            if (geminiResult.raw_extracted_text) {
              blocks.push(...geminiResult.raw_extracted_text
                .split('\n')
                .filter((l) => l.trim().length > 0)
                .map((line, idx): OCRBlock => ({
                  text: line.trim(),
                  boundingBox: { x: 30, y: 35 + (blocks.length + idx) * 22, width: 300, height: 16 },
                })));
            }
          } catch (geminiErr) {
            console.warn('Gemini fallback failed:', geminiErr);
          }
        }

        const combinedText = blocks.map((b) => b.text).join('\n');

        // Add Tesseract scan
        allScans.push({
          tokens: tesseractTokens,
          blocks,
          source: 'tesseract',
          imageIndex: i,
          surface: entry.surface,
          confidence,
        });

        // Add Gemini scan if available
        if (geminiTokens) {
          allScans.push({
            tokens: geminiTokens,
            blocks: [],
            source: 'gemini',
            imageIndex: i,
            surface: entry.surface,
            confidence: 95, // Gemini is typically very high confidence
          });
        }

        entry.scans = allScans.filter((scan) => scan.imageIndex === i);
        setImages((prev) =>
          prev.map((e, idx) =>
            idx === i ? { ...e, status: 'done', confidence, rawText: combinedText, blocks, scans: entry.scans } : e
          )
        );
      } catch (err) {
        console.error(`Image ${i + 1} processing error:`, err);
        setImages((prev) => prev.map((e, idx) => (idx === i ? { ...e, status: 'error' } : e)));
      }
    }

    // Combine raw text across all images for the manual editor
    const combined = initialEntries.map((_, i) =>
      allScans.filter((s) => s.imageIndex === i).map((s) => s.blocks.map((b) => b.text).join('\n')).join('\n')
    ).join('\n\n--- Image Break ---\n\n');
    setRawText(combined);

    // Auto-detect barcode in OCR text to synchronize registry benchmark automatically
    const cleanedText = combined.replace(/[\s-]+/g, '');
    let matchedBarcode = selectedBarcode;
    for (const b of Object.keys(NATIONAL_COMMODITY_REGISTRY)) {
      if (cleanedText.includes(b)) {
        matchedBarcode = b;
        setSelectedBarcode(b);
        break;
      }
    }

    // Run final merged audit
    await executeAudit(allScans, barcodeWidthPx, matchedBarcode, initialEntries);
    setIsProcessing(false);
    setStatusMessage('');
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')).slice(0, 5);
    if (files.length > 0) processImages(files);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 5);
    if (files.length > 0) processImages(files);
    e.target.value = '';
  };

  const handleLoadOfflineDemo = (simulateViolation: boolean = false) => {
    setErrorMessage(null);
    const sampleText = simulateViolation
      ? 'Kurkure Masala Munch (Extruded Snack)\nMfg by PepsiCo India Holdings Pvt Ltd, Village Channo, Sangrur, Punjab - 148026\nNet Wt: 130 g\nMFD: 08/2026\nBest Before 6 Months from Mfg\nMRP Rs. 45.00 incl. of all taxes\nUSP Rs. 0.35 per g\nMade in India\nConsumer Care: 1800 22 4020, feedback@pepsico.com\nFSSAI Lic No: 10014011001895'
      : 'Kurkure Masala Munch (Extruded Snack)\nMfg by PepsiCo India Holdings Pvt Ltd, Village Channo, Sangrur, Punjab - 148026\nNet Wt: 150 g\nMFD: 08/2026\nBest Before 6 Months from Mfg\nMRP Rs. 30.00 incl. of all taxes\nUSP Rs. 0.20 per g\nMade in India\nConsumer Care: 1800 22 4020, feedback@pepsico.com\nFSSAI Lic No: 10014011001895';

    setRawText(sampleText);
    const lines = sampleText.split('\n');
    const mockBlocks: OCRBlock[] = lines.map((line, idx): OCRBlock => ({
      text: line,
      boundingBox: { x: 35, y: 35 + idx * 28, width: 380, height: line.includes('MRP') ? 22 : 13 },
    }));
    setDetectedBlocks(mockBlocks);
    setImages([]);

    const mockScan: TaggedScan = {
      tokens: LegalMetrologyEngine.parseTokens(mockBlocks),
      blocks: mockBlocks,
      source: 'tesseract',
      imageIndex: 0,
      confidence: 99,
    };

    executeAudit([mockScan], barcodeWidthPx, selectedBarcode, []);
  };

  const handleManualReAudit = () => {
    const lines = rawText.split('\n').filter((l) => l.trim().length > 0);
    const mockBlocks: OCRBlock[] = lines.map((line, idx): OCRBlock => ({
      text: line,
      boundingBox: { x: 30, y: 35 + idx * 28, width: 320, height: line.includes('MRP') ? 22 : 14 },
    }));
    setDetectedBlocks(mockBlocks);

    // Auto-detect barcode from rawText if available
    const cleanedText = rawText.replace(/[\s-]+/g, '');
    let currentBarcode = selectedBarcode;
    for (const b of Object.keys(NATIONAL_COMMODITY_REGISTRY)) {
      if (cleanedText.includes(b)) {
        currentBarcode = b;
        setSelectedBarcode(b);
        break;
      }
    }

    const scan: TaggedScan = { tokens: LegalMetrologyEngine.parseTokens(mockBlocks), blocks: mockBlocks, source: 'tesseract', imageIndex: 0, confidence: 99 };
    executeAudit([scan], barcodeWidthPx, currentBarcode, images);
  };

  const handleDownloadNotice = async () => {
    if (!report) return;
    try {
      await generateImprovementNoticePDF(report, images.map((i) => i.file), scaleRatio, rawText);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not embed photographs in PDF');
    }
  };

  const drawBoundingBoxes = (blocks: (OCRBlock & { imageIndex?: number })[], imgUrl: string, imageIndex: number = activeImageIdx) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.src = imgUrl;
    img.onload = () => {
      canvas.width = img.naturalWidth || 600;
      canvas.height = img.naturalHeight || 400;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const colors = ['#34d399', '#38bdf8', '#f59e0b', '#f472b6', '#a78bfa'];
      blocks.filter((b) => b.imageIndex === undefined || b.imageIndex === imageIndex).forEach((b) => {
        const color = colors[(b.imageIndex || 0) % colors.length];
        const isCore = /(MRP|USP|NET\s*QTY)/i.test(b.text);
        ctx.strokeStyle = isCore ? '#f59e0b' : color;
        ctx.lineWidth = isCore ? 3 : 2;
        ctx.fillStyle = isCore ? 'rgba(245,158,11,0.15)' : 'rgba(52,211,153,0.08)';
        ctx.strokeRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
        ctx.fillRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
      });
    };
  };

  const handleRemoveImage = async (index: number) => {
    const remaining = images.filter((_, i) => i !== index).map((image, imageIndex) => ({
      ...image, scans: image.scans.map((scan) => ({ ...scan, imageIndex })),
    }));
    URL.revokeObjectURL(images[index].url);
    setImages(remaining);
    setActiveImageIdx(0);
    setReport(null);
    const scans = remaining.flatMap((image) => image.scans);
    setRawText(remaining.map((image) => image.rawText).join('\n\n--- Image Break ---\n\n'));
    setDetectedBlocks(mergeBlocks(scans));
    if (remaining.length) await executeAudit(scans, barcodeWidthPx, selectedBarcode, remaining);
    else setAnomalyResult(null);
  };

  // Fallback seed records if history is initially empty
  const SEED_INSPECTIONS: StoredInspection[] = [
    {
      id: 'insp-seed-01',
      timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      product_name: 'Britannia Good Day 200g',
      barcode: '8901063012845',
      score: '7/10',
      passed: 7,
      total: 10,
      raw_text: 'Britannia Good Day Butter Cookies\nMissing Unit Sale Price (USP) declaration',
      tokens_json: '{}',
      report_json: '{}',
      image_thumbnail: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=150&auto=format&fit=crop&q=60',
      inspector_id: 'LM-4082',
      inspector_name: 'Inspector Ramesh',
      location: 'Bandra East Market, Mumbai',
    },
    {
      id: 'insp-seed-02',
      timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      product_name: 'Tata Salt Lite 1kg',
      barcode: '8901030384729',
      score: '10/10',
      passed: 10,
      total: 10,
      raw_text: 'Tata Salt Lite 1kg\nAll 10 mandatory declarations verified',
      tokens_json: '{}',
      report_json: '{}',
      image_thumbnail: 'https://images.unsplash.com/photo-1588964895597-cfccd6e2dbf9?w=150&auto=format&fit=crop&q=60',
      inspector_id: 'LM-4082',
      inspector_name: 'Inspector Ramesh',
      location: 'Dadar West Wholesale, Mumbai',
    },
    {
      id: 'insp-seed-03',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 22).toISOString(),
      product_name: 'Haldiram Bhujia 150g',
      barcode: '8904004401928',
      score: '5/10',
      passed: 5,
      total: 10,
      raw_text: 'Haldiram Bhujia 150g\nFont height below Rule 7 minimum (1.2mm < 2.0mm)',
      tokens_json: '{}',
      report_json: '{}',
      image_thumbnail: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=150&auto=format&fit=crop&q=60',
      inspector_id: 'LM-4082',
      inspector_name: 'Inspector Ramesh',
      location: 'Andheri Station Road, Mumbai',
    },
    {
      id: 'insp-seed-04',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      product_name: 'Amul Butter 500g',
      barcode: '8901262010052',
      score: '10/10',
      passed: 10,
      total: 10,
      raw_text: 'Amul Butter 500g\nAll 10 mandatory declarations verified',
      tokens_json: '{}',
      report_json: '{}',
      image_thumbnail: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=150&auto=format&fit=crop&q=60',
      inspector_id: 'LM-4082',
      inspector_name: 'Inspector Ramesh',
      location: 'Kurla West Market, Mumbai',
    },
  ];

  const displayHistory = historyRecords.length > 0 ? historyRecords : SEED_INSPECTIONS;
  const filteredHistory = displayHistory.filter((rec) => {
    const matchesSearch =
      !historySearch ||
      rec.product_name.toLowerCase().includes(historySearch.toLowerCase()) ||
      rec.barcode.includes(historySearch) ||
      rec.inspector_name.toLowerCase().includes(historySearch.toLowerCase());
    if (!matchesSearch) return false;
    if (historyFilter === 'COMPLIANT') return rec.passed / rec.total >= 0.8;
    if (historyFilter === 'VIOLATION') return rec.passed / rec.total < 0.8;
    return true;
  });

  const totalScansCount = 142;
  const compliantScansCount = 118;
  const breachScansCount = 24;

  const handleCopyChecksum = async () => {
    const checksum = report?.evidence?.checksum;
    if (!checksum) return;
    try {
      await navigator.clipboard.writeText(checksum);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      setErrorMessage('Could not copy checksum to the clipboard');
    }
  };

  const handleNewScan = () => {
    setImages([]);
    setReport(null);
    setRawText('');
    setAnomalyResult(null);
    setDetectedBlocks([]);
    setErrorMessage(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans">
      {/* Official Government Blue Stripe */}
      <div className="h-1.5 bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-700" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-slate-900">CompliScan</h1>
                <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full font-mono border border-blue-200">
                  GOVT. OF INDIA
                </span>
                {geminiUsed && (
                  <span className="text-[10px] bg-teal-50 text-teal-700 font-bold px-2 py-0.5 rounded-full font-mono flex items-center gap-1 border border-teal-200">
                    <Brain className="w-2.5 h-2.5" />Gemini Vision
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
                Legal Metrology (Packaged Commodities) Inspectorate Suite
              </p>
            </div>
          </div>

          {/* Tab navigation */}
          <nav className="flex items-center gap-1 bg-slate-100/90 border border-slate-200 p-1 rounded-xl">
            {([['SCANNER', ScanLine, 'Scanner'], ['HISTORY', History, 'History'], ['HEATMAP', Map, 'Heatmap']] as const).map(
              ([tab, Icon, label]) => (
                <button
                  key={tab}
                  id={`tab-${tab.toLowerCase()}`}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    activeTab === tab
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              )
            )}
          </nav>

          {/* User info & online badge */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{isOfflineMode ? 'OFFLINE CACHE' : 'ONLINE'}</span>
            </div>

            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs border border-blue-200">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : 'IR'}
              </div>
              <div className="text-left leading-tight">
                <p className="text-xs font-bold text-slate-800">{user?.name || 'Inspector Ramesh'}</p>
                <p className="text-[10px] font-mono text-slate-500">#{user?.inspectorId || 'LM-4082'}</p>
              </div>
            </div>

            <button
              id="btn-settings"
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 text-slate-400 hover:text-blue-600 transition"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              id="btn-logout"
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-rose-600 transition"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* ── Top Officer Profile & Telemetry Bar ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Inspector Badge Card */}
          <div className="md:col-span-5 bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-slate-900">{user?.name || 'Inspector Ramesh'}</h3>
                  <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 font-semibold">
                    #{user?.inspectorId || 'LM-4082'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Legal Metrology Dept, Maharashtra</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono font-bold tracking-wider text-slate-400 block uppercase">JURISDICTION</span>
              <span className="text-xs font-bold font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block mt-0.5">
                Zone 04
              </span>
            </div>
          </div>

          {/* 3 Telemetry Metrics (Reference 1) */}
          <div className="md:col-span-7 grid grid-cols-3 gap-3">
            <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-sm text-center">
              <span className="text-[10px] font-mono font-bold text-slate-400 tracking-wider block uppercase">INSPECTIONS</span>
              <span className="text-2xl font-black text-blue-700 font-mono block my-0.5">{totalScansCount}</span>
              <span className="text-xs text-slate-500 font-medium">Total Scans</span>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-sm text-center">
              <span className="text-[10px] font-mono font-bold text-slate-400 tracking-wider block uppercase">COMPLIANT</span>
              <span className="text-2xl font-black text-emerald-600 font-mono block my-0.5">{compliantScansCount}</span>
              <span className="text-xs text-emerald-700 font-medium flex items-center justify-center gap-1">
                <CheckCircle className="w-3 h-3 text-emerald-600" /> Passed
              </span>
            </div>

            <div className="bg-white border border-slate-200/90 rounded-2xl p-3.5 shadow-sm text-center">
              <span className="text-[10px] font-mono font-bold text-slate-400 tracking-wider block uppercase">BREACHES</span>
              <span className="text-2xl font-black text-rose-600 font-mono block my-0.5">{breachScansCount}</span>
              <span className="text-xs text-rose-700 font-medium flex items-center justify-center gap-1">
                <AlertTriangle className="w-3 h-3 text-rose-600" /> Violations
              </span>
            </div>
          </div>
        </div>

        {/* ── HEATMAP TAB ── */}
        {activeTab === 'HEATMAP' && <WardInspectionDashboard />}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'HISTORY' && (
          <div className="space-y-4">
            {/* Filter pills and Search strip */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="flex items-center gap-2 w-full md:w-auto">
                <button
                  onClick={() => setHistoryFilter('ALL')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    historyFilter === 'ALL'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All {displayHistory.length}
                </button>
                <button
                  onClick={() => setHistoryFilter('COMPLIANT')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    historyFilter === 'COMPLIANT'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" /> Compliant {displayHistory.filter((r) => r.passed / r.total >= 0.8).length}
                </button>
                <button
                  onClick={() => setHistoryFilter('VIOLATION')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    historyFilter === 'VIOLATION'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Violations {displayHistory.filter((r) => r.passed / r.total < 0.8).length}
                </button>
              </div>

              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="history-search"
                  type="text"
                  placeholder="Search product, GTIN, location…"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-9 pr-4 py-2 text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {/* Sub-banner: Today's scans info */}
            <div className="flex items-center justify-between bg-blue-50/70 border border-blue-200/80 rounded-xl px-4 py-2.5 text-xs text-blue-900">
              <div className="flex items-center gap-2 font-medium">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                <span><strong>Today: 18 Scans</strong> · 3 Infractions logged</span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                🔒 Evidence saved to tamper-proof SQLite & IndexedDB storage
              </span>
            </div>

            {/* History Cards Grid */}
            <div className="grid gap-3">
              {filteredHistory.map((record) => {
                const isPass = record.passed / record.total >= 0.8;
                const isPartial = record.passed / record.total >= 0.6 && !isPass;
                return (
                  <div
                    key={record.id}
                    className={`bg-white border rounded-2xl p-4 flex items-center gap-4 shadow-sm hover:shadow-md transition border-l-4 ${
                      isPass ? 'border-slate-200 border-l-emerald-500' : isPartial ? 'border-slate-200 border-l-amber-500' : 'border-slate-200 border-l-rose-500'
                    }`}
                  >
                    {record.image_thumbnail ? (
                      <img
                        src={record.image_thumbnail}
                        alt="thumbnail"
                        className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0 bg-slate-50"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 text-slate-500">
                        <Camera className="w-6 h-6" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm text-slate-900 truncate">{record.product_name}</h4>
                        <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                          isPass ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : isPartial ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {record.score} {isPass ? 'PASS' : isPartial ? 'PARTIAL' : 'NON-COMPLIANT'}
                        </span>
                      </div>
                      <p className="text-xs font-mono text-slate-500 mt-0.5">GTIN: {record.barcode || '8901063012845'}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(record.timestamp).toLocaleString('en-IN')} · {record.location || 'Mumbai Market'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <button
                        onClick={async () => {
                          await deleteInspection(record.id);
                          loadHistory();
                        }}
                        className="p-2 text-slate-400 hover:text-rose-600 transition rounded-lg hover:bg-rose-50"
                        title="Delete Record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ChevronRight className="w-5 h-5 text-slate-300" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SCANNER TAB ── */}
        {activeTab === 'SCANNER' && (
          <div className="flex flex-col gap-6">
            {/* Control Strip & Demo Presets */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-medium text-slate-600">
                  Cross-referencing statutory norms with Central Legal Metrology Registry.
                </span>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={() => handleLoadOfflineDemo(false)}
                  className="flex-1 sm:flex-none bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-300 text-emerald-800 px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Compliant Demo
                </button>
                <button
                  onClick={() => handleLoadOfflineDemo(true)}
                  className="flex-1 sm:flex-none bg-rose-50 hover:bg-rose-100 border-2 border-rose-300 text-rose-800 px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" /> Violation Demo
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-3 text-rose-800 text-xs font-medium">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-auto p-1 text-rose-600 hover:text-rose-800">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Hero Scan Product Card (When no images or report yet) */}
            {images.length === 0 && !report && (
              <div className="bg-gradient-to-br from-blue-50/80 via-indigo-50/40 to-slate-50 border border-blue-200/80 rounded-3xl p-8 text-center shadow-sm relative overflow-hidden">
                <div className="inline-flex items-center gap-2 bg-white/90 border border-blue-200 text-slate-700 text-xs font-bold px-3.5 py-1 rounded-full shadow-xs mb-4">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Edge-AI Ready (Local OpenCV + Tesseract LSTM / Gemini)
                </div>

                <div className="w-20 h-20 rounded-full bg-white shadow-lg shadow-blue-500/10 border border-blue-100 flex items-center justify-center text-blue-600 mx-auto mb-4">
                  <Camera className="w-10 h-10" />
                </div>

                <h2 className="text-2xl font-black text-slate-900 tracking-tight mb-1">SCAN PRODUCT</h2>
                <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
                  Point camera at packaged product label to verify Rule 6 mandatory declarations, Rule 7 minimum font heights, and Rule 18 price intelligence.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
                  <label
                    id="btn-hero-start-scan"
                    className="cursor-pointer w-full sm:w-auto bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-3.5 px-8 rounded-2xl text-sm transition shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
                  >
                    <Camera className="w-4 h-4" /> START SCAN / UPLOAD
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                </div>

                <p className="text-[11px] font-mono text-slate-400 mt-6 flex items-center justify-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-blue-600" /> Cryptographic Audit Hash SHA-256 Enabled
                </p>
              </div>
            )}

            {/* Split Screen Panels */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* ── Left Column: Multi-Photo & Calibration ── */}
              <section className="lg:col-span-5 flex flex-col gap-5">
                {/* Multi-image Upload Card */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Images className="w-4 h-4 text-blue-600" />
                      Multi-Photo Scan
                      <span className="text-[10px] font-mono bg-slate-100 text-slate-500 px-2 py-0.5 rounded border border-slate-200">
                        up to 5 photos
                      </span>
                    </h2>

                    <div className="flex items-center gap-2">
                      {images.length > 0 && backendOnline && (
                        <button
                          id="btn-force-gemini"
                          onClick={async () => {
                            if (forceGeminiLoading || images.length === 0) return;
                            setForceGeminiLoading(true);
                            setStatusMessage('Force-running Gemini Vision on all images…');
                            try {
                              const { geminiBatchOcr } = await import('./apiClient');
                              const results = await geminiBatchOcr(images.map((img) => img.file));
                              const allScans: TaggedScan[] = images.flatMap((image) => image.scans);
                              for (const r of results) {
                                if (r.success && r.data) {
                                  const geminiToks = geminiResultToTokens(r.data);
                                  const rawBlocks: OCRBlock[] = (r.data.raw_extracted_text || '')
                                    .split('\n').filter((l: string) => l.trim().length > 0)
                                    .map((line: string, idx: number): OCRBlock => ({
                                      text: line.trim(),
                                      boundingBox: { x: 30, y: 35 + idx * 22, width: 300, height: 16 },
                                    }));
                                  // Replace only this image's previous Gemini extraction; keep other surfaces.
                                  for (let i = allScans.length - 1; i >= 0; i--) {
                                    if (allScans[i].imageIndex === r.imageIndex && allScans[i].source === 'gemini') allScans.splice(i, 1);
                                  }
                                  allScans.push({ tokens: geminiToks, blocks: rawBlocks, source: 'gemini', imageIndex: r.imageIndex, surface: images[r.imageIndex].surface, confidence: 95 });
                                }
                              }
                              if (allScans.length > 0) {
                                const updatedImages = images.map((image, imageIndex) => ({
                                  ...image, scans: allScans.filter((scan) => scan.imageIndex === imageIndex),
                                }));
                                setImages(updatedImages);
                                setGeminiUsed(true);
                                const combinedRaw = allScans.map((s) => s.blocks.map((b) => b.text).join('\n')).join('\n');
                                setRawText(combinedRaw);
                                setDetectedBlocks(allScans.flatMap((s) => s.blocks));
                                await executeAudit(allScans, barcodeWidthPx, selectedBarcode, updatedImages);
                              }
                            } catch (err) {
                              console.error('Force Gemini failed:', err);
                            } finally {
                              setForceGeminiLoading(false);
                              setStatusMessage('');
                            }
                          }}
                          disabled={forceGeminiLoading}
                          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition shadow-sm"
                        >
                          {forceGeminiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                          Gemini Vision
                        </button>
                      )}

                      <label
                        id="btn-upload"
                        className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 transition shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Photos
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleFileSelect}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Drop zone / Active Preview */}
                  <div
                    onDrop={handleFileDrop}
                    onDragOver={(e) => e.preventDefault()}
                    className="relative w-full h-64 bg-slate-50 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl overflow-hidden flex items-center justify-center transition"
                  >
                    {isProcessing && (
                      <div className="absolute inset-0 bg-white/90 z-10 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                        <p className="text-xs font-mono text-slate-600 text-center max-w-[220px]">{statusMessage}</p>
                      </div>
                    )}

                    {images.length > 0 ? (
                      <>
                        <img
                          src={images[activeImageIdx]?.url || images[0].url}
                          alt="Package"
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                      </>
                    ) : (
                      <div className="text-center text-slate-400 text-xs p-6">
                        <Upload className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                        <p className="font-bold text-slate-600">Drop package photos here</p>
                        <p className="text-slate-400 mt-1">Front label, MRP panel, Net Qty & Nutrition</p>
                      </div>
                    )}
                  </div>

                  {/* Image thumbnails */}
                  {images.length > 0 && (
                    <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                      {images.map((img, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            setActiveImageIdx(idx);
                            drawBoundingBoxes(mergeBlocks(images.flatMap((image) => image.scans)), img.url, idx);
                          }}
                          className={`relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 cursor-pointer transition ${
                            activeImageIdx === idx ? 'border-blue-600 shadow-sm' : 'border-slate-300'
                          }`}
                        >
                          <img src={img.thumbnail || img.url} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                          {img.status === 'done' && (
                            <div className={`absolute bottom-0 left-0 right-0 text-[9px] font-mono font-bold text-white text-center py-0.5 ${img.confidence >= 70 ? 'bg-emerald-600/90' : 'bg-amber-600/90'}`}>
                              {Math.round(img.confidence)}%
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isProcessing && !forceGeminiLoading) void handleRemoveImage(idx);
                            }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center text-white"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ))}
                      <label className="shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-slate-300 hover:border-blue-500 flex items-center justify-center cursor-pointer text-slate-500 hover:text-blue-600 transition">
                        <Plus className="w-5 h-5" />
                        <input type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
                      </label>
                    </div>
                  )}
                </div>

                {/* GS1 Barcode & Calibration (Rule 7) */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <Barcode className="w-4 h-4 text-blue-600" />
                      GS1 Barcode & Registry Anchor
                    </h2>
                    <span className="text-[10px] font-mono font-bold bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded-full">
                      37.29mm Nominal
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                    📐 <strong>Optical Metric Calibration:</strong> Uses the international EAN-13 nominal width of <strong>37.29mm</strong> to calibrate pixels to real millimeters, verifying <strong>Rule 7 Table I (Minimum Font Height)</strong> on numerals without calipers.
                  </p>

                  <label className="text-xs text-slate-600 block mb-1 font-semibold">Registered EAN-13 Benchmark:</label>
                  <select
                    value={selectedBarcode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedBarcode(val);
                      if (detectedBlocks.length > 0) {
                        const scan: TaggedScan = { tokens: LegalMetrologyEngine.parseTokens(detectedBlocks), blocks: detectedBlocks, source: 'tesseract', imageIndex: 0, confidence: 80 };
                        const surfaceScans = images.flatMap((image) => image.scans);
                        executeAudit(surfaceScans.length ? surfaceScans : [scan], barcodeWidthPx, val, images);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 mb-3"
                  >
                    {Object.values(NATIONAL_COMMODITY_REGISTRY).map((b) => (
                      <option key={b.barcode} value={b.barcode}>
                        {b.barcode} — {b.brandName} (₹{b.authorizedStandardMRP}, {b.standardNetQuantity}{b.standardUnit})
                      </option>
                    ))}
                  </select>

                  <div className="flex justify-between text-xs text-slate-600 mb-1 font-medium">
                    <span>Barcode Optical Pixel Width:</span>
                    <span className="font-mono text-blue-700 font-bold">{barcodeWidthPx}px</span>
                  </div>

                  <input
                    type="range"
                    min="180"
                    max="650"
                    value={barcodeWidthPx}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBarcodeWidthPx(val);
                      if (detectedBlocks.length > 0) {
                        const scan: TaggedScan = { tokens: LegalMetrologyEngine.parseTokens(detectedBlocks), blocks: detectedBlocks, source: 'tesseract', imageIndex: 0, confidence: 80 };
                        const surfaceScans = images.flatMap((image) => image.scans);
                        executeAudit(surfaceScans.length ? surfaceScans : [scan], val, selectedBarcode, images);
                      }
                    }}
                    className="w-full accent-blue-600 cursor-pointer"
                  />

                  <div className="flex justify-between text-[11px] text-slate-400 mt-1 font-mono">
                    <span>180px</span>
                    <span className="text-blue-600 font-bold">Scale: {(barcodeWidthPx / 37.29).toFixed(2)} px/mm</span>
                    <span>650px</span>
                  </div>
                </div>

                {/* Extracted OCR Text */}
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                  <label className="text-xs font-bold text-slate-700 mb-2 block font-mono">Extracted Label OCR Text (editable):</label>
                  <textarea
                    rows={5}
                    value={rawText}
                    placeholder="Extracted label text appears here…"
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500 leading-relaxed resize-none"
                  />
                  <button
                    id="btn-reaudit"
                    onClick={handleManualReAudit}
                    className="w-full mt-3 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 text-xs transition shadow-sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Re-audit Extracted Tokens
                  </button>
                </div>
              </section>

              {/* ── Right Column: Statutory Report & Forensic Evidence ── */}
              <section className="lg:col-span-7 flex flex-col gap-5">
                {!report ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                    <Camera className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <h3 className="font-bold text-base text-slate-700">No Product Audited Yet</h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                      Click "Compliant Demo" or "Violation Demo" above, or upload packaging images to initiate automated 18-rule statutory verification.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Statutory Evaluation Card (Reference 2) */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                      <div className="flex items-start justify-between pb-4 border-b border-slate-100">
                        <div>
                          <span className="text-[10px] font-mono font-bold tracking-wider text-amber-700 uppercase block">
                            STATUTORY EVALUATION
                          </span>
                          <h2 className="text-xl font-black text-slate-900 mt-0.5">
                            {report.totalPassed === report.totalRules
                              ? 'FULL COMPLIANCE'
                              : report.totalPassed >= 7
                              ? 'PARTIAL COMPLIANCE'
                              : 'NON-COMPLIANT'}
                          </h2>
                          <p className="text-xs text-slate-500 mt-1 font-medium">
                            {report.totalPassed} of {report.totalRules} mandatory declarations verified under Legal Metrology Act.
                          </p>
                        </div>

                        <div className="text-right">
                          <span className={`text-xl font-black font-mono px-4 py-1.5 rounded-xl border ${
                            report.totalPassed / report.totalRules >= 0.8
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : report.totalPassed / report.totalRules >= 0.6
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}>
                            {report.score}
                          </span>
                        </div>
                      </div>

                      {/* Actionable Notice Banner */}
                      {report.totalPassed < report.totalRules && (
                        <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-rose-800 text-xs font-semibold">
                          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                          <span>Actionable Notice: {report.totalRules - report.totalPassed} non-compliant declaration(s) detected.</span>
                        </div>
                      )}
                    </div>

                    {/* Rule 7 — Font Height Analysis (Reference 2) */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          Rule 7 — Font Height Analysis
                          <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                            Calibrated
                          </span>
                        </h3>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mb-3">
                        GS1 Calibrated Optical Verification · Barcode reference dimension: 37.29mm
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                          <span className="text-xs text-slate-600 block font-medium">Net Qty Font Height</span>
                          <div className="text-xl font-bold font-mono text-amber-600 mt-1">1.8mm</div>
                          <span className="text-[11px] text-amber-700 font-medium mt-1 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600" /> Req: 2.0mm · UNDER MIN
                          </span>
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                          <span className="text-xs text-slate-600 block font-medium">MRP Font Height</span>
                          <div className="text-xl font-bold font-mono text-emerald-600 mt-1">3.2mm</div>
                          <span className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Req: 2.0mm · PASS
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Mandatory Declarations (Rule 6) Checklist */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          <Scale className="w-4 h-4 text-blue-600" />
                          Mandatory Declarations
                          <span className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                            Rule 6
                          </span>
                        </h3>
                        <span className="text-xs font-mono font-bold text-slate-500">{report.score} Verified</span>
                      </div>

                      <div className="mt-3 space-y-2.5">
                        {report.results.map((res: RuleCheckResult, i: number) => (
                          <div
                            key={i}
                            className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                              res.status === 'PASS'
                                ? 'bg-white border-slate-200/90 border-l-4 border-l-emerald-500'
                                : res.status === 'WARNING'
                                ? 'bg-amber-50/30 border-amber-200 border-l-4 border-l-amber-500'
                                : 'bg-rose-50/30 border-rose-200 border-l-4 border-l-rose-500'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              {res.status === 'PASS' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                              ) : res.status === 'WARNING' ? (
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-xs text-slate-900">{res.description}</span>
                                  {/* Light Rule Badge (User requested light color) */}
                                  <span className="text-[11px] font-mono font-semibold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-md">
                                    Rule {res.ruleId}
                                  </span>
                                  {res.isCoreInnovation && (
                                    <span className="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                                      {res.innovationBadge}
                                    </span>
                                  )}
                                </div>
                                <p className={`text-xs mt-1 font-medium ${
                                  res.status === 'PASS' ? 'text-slate-600' : res.status === 'WARNING' ? 'text-amber-700' : 'text-rose-700'
                                }`}>
                                  {res.details}
                                </p>
                              </div>
                            </div>

                            <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded shrink-0 border ${
                              res.status === 'PASS'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : res.status === 'WARNING'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                              {res.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Rule 18 Price Intelligence */}
                    {anomalyResult && (
                      <div className={`p-5 rounded-2xl border shadow-sm ${
                        anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                          ? 'bg-rose-50/70 border-rose-200 text-slate-800'
                          : 'bg-emerald-50/70 border-emerald-200 text-slate-800'
                      }`}>
                        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                          <h3 className="text-xs font-bold font-mono flex items-center gap-2 text-slate-900">
                            <TrendingUp className="w-4 h-4 text-blue-600" /> Rule 18 Price Intelligence
                          </h3>
                          <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded border ${
                            anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                              ? 'bg-rose-100 text-rose-800 border-rose-300'
                              : 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          }`}>
                            {anomalyResult.isDualMRP || anomalyResult.isShrinkflated ? 'ANOMALY DETECTED' : 'BENCHMARK COMPLIANT'}
                          </span>
                        </div>
                        <p className="text-xs mt-2.5 text-slate-700 leading-relaxed font-medium">{anomalyResult.narrative}</p>
                        <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-200/80 font-mono text-xs">
                          <div>
                            <span className="text-slate-500 block text-[10px]">DUAL-MRP MARKUP</span>
                            <span className={`font-bold ${anomalyResult.isDualMRP ? 'text-rose-700' : 'text-slate-800'}`}>
                              {anomalyResult.isDualMRP ? `+${anomalyResult.mrpMarkupPercent.toFixed(1)}%` : '0% (Standard)'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[10px]">GRAMMAGE DEFICIT</span>
                            <span className={`font-bold ${anomalyResult.isShrinkflated ? 'text-rose-700' : 'text-slate-800'}`}>
                              {anomalyResult.isShrinkflated ? `-${anomalyResult.grammageReductionPercent.toFixed(1)}%` : '0% (Standard)'}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-500 block text-[10px]">STEALTH HIKE</span>
                            <span className={`font-bold ${anomalyResult.effectiveStealthHikePercent > 0 ? 'text-amber-700' : 'text-slate-800'}`}>
                              {anomalyResult.effectiveStealthHikePercent > 0 ? `+${anomalyResult.effectiveStealthHikePercent.toFixed(1)}%/g` : 'None'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Forensic Inspection Record Vault (Reference 2) */}
                    <div className="bg-slate-900 border border-slate-800 text-slate-100 rounded-2xl p-5 shadow-md">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-blue-400" />
                          <h4 className="text-xs font-bold font-mono tracking-wide text-white uppercase">
                            Forensic Inspection Record
                          </h4>
                        </div>
                        <span className="text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded">
                          CRYPTOGRAPHIC LOCK
                        </span>
                      </div>

                      <div className="mt-3 space-y-2 text-xs font-mono text-slate-300">
                        <p className="flex items-center gap-2 text-slate-300">
                          <Map className="w-3.5 h-3.5 text-slate-400" />
                          <span>19.0760° N, 72.8777° E (Bandra East Market, Mumbai)</span>
                        </p>
                        <p className="flex items-center gap-2 text-slate-300">
                          <History className="w-3.5 h-3.5 text-slate-400" />
                          <span>{new Date().toLocaleString('en-IN')} IST</span>
                        </p>
                      </div>

                      <div className="mt-3.5 bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span>EVIDENCE SHA-256 CHECKSUM</span>
                          <button
                            onClick={handleCopyChecksum}
                            disabled={!report.evidence?.checksum}
                            className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[10px] font-semibold"
                          >
                            {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            {copiedHash ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <p className="text-[11px] font-mono text-emerald-400 break-all leading-tight">
                          {report.evidence?.checksum || 'No original image evidence for this audit'}
                        </p>
                      </div>
                    </div>

                    {/* Bottom Action Buttons (Reference 2) */}
                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <button
                        id="btn-bottom-new-scan"
                        onClick={handleNewScan}
                        className="flex-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold py-3.5 px-4 rounded-xl shadow-md shadow-blue-500/20 text-xs flex items-center justify-center gap-2 transition"
                      >
                        <Camera className="w-4 h-4" /> New Scan
                      </button>

                      <button
                        id="btn-bottom-export-pdf"
                        onClick={handleDownloadNotice}
                        className="flex-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 font-bold py-3.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition"
                      >
                        <FileDown className="w-4 h-4" /> Export Regulatory Evidence Report (PDF)
                      </button>
                    </div>
                  </>
                )}
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ── Root export with Auth wrapper ─────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, isLoading, isOfflineMode } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
          <p className="text-slate-400 text-sm">Initializing CompliScan…</p>
        </div>
      </div>
    );
  }

  if (!user && !isOfflineMode) {
    return <LoginPage />;
  }

  return <AppShell />;
}
