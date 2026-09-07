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
  Zap,
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
  Download,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import { MetricFiducialEngine, LegalMetrologyEngine } from './engine';
import type { OCRBlock, ComplianceReport, RuleCheckResult } from './engine';
import { generateImprovementNoticePDF, exportReportAsJSON, exportReportAsCSV } from './pdfGenerator';
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
        drawBoundingBoxes(mergedBlocks, allImages[0].url);
      }

      const auditReport = LegalMetrologyEngine.audit(mergedTokens, calibration);

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
          if (packResult.status === 'PASS') {
            auditReport.totalPassed += 1;
            auditReport.score = `${auditReport.totalPassed}/${auditReport.totalRules}`;
          }
        }
      }

      setReport(auditReport);

      // Anomaly (price/grammage) detection
      if (mergedTokens.mrp && mergedTokens.netQuantity) {
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
    if (files.length === 0) return;

    setIsProcessing(true);
    setErrorMessage(null);
    setReport(null);
    setGeminiUsed(false);

    // Initialize image entries
    const initialEntries: ImageEntry[] = await Promise.all(
      files.map(async (file) => {
        const url = URL.createObjectURL(file);
        const thumbnail = await generateThumbnail(file).catch(() => '');
        return { file, url, thumbnail, status: 'pending' as const, confidence: 0, rawText: '', blocks: [] };
      })
    );
    setImages(initialEntries);
    setActiveImageIdx(0);

    const allScans: TaggedScan[] = [];

    for (let i = 0; i < initialEntries.length; i++) {
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
          confidence,
        });

        // Add Gemini scan if available
        if (geminiTokens) {
          allScans.push({
            tokens: geminiTokens,
            blocks: [],
            source: 'gemini',
            imageIndex: i,
            confidence: 95, // Gemini is typically very high confidence
          });
        }

        setImages((prev) =>
          prev.map((e, idx) =>
            idx === i ? { ...e, status: 'done', confidence, rawText: combinedText, blocks } : e
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

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')).slice(0, 5);
    if (files.length > 0) processImages(files);
  }, [barcodeWidthPx, selectedBarcode]);

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

  const handleDownloadNotice = () => {
    if (!report) return;
    generateImprovementNoticePDF(report, images.map((i) => i.url), scaleRatio, rawText);
  };

  const drawBoundingBoxes = (blocks: (OCRBlock & { imageIndex?: number })[], imgUrl: string) => {
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
      blocks.forEach((b) => {
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-emerald-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight">CompliScan</h1>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-mono font-semibold">SIH-26034</span>
                {geminiUsed && (
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full font-mono flex items-center gap-1">
                    <Brain className="w-2.5 h-2.5" />Gemini Enhanced
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 hidden md:block">Legal Metrology (Packaged Commodities) Rules, 2011</p>
            </div>
          </div>

          {/* Tab navigation */}
          <nav className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
            {([['SCANNER', ScanLine, 'Scanner'], ['HISTORY', History, 'History'], ['HEATMAP', Map, 'Heatmap']] as const).map(
              ([tab, Icon, label]) => (
                <button
                  key={tab}
                  id={`tab-${tab.toLowerCase()}`}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeTab === tab ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              )
            )}
          </nav>

          {/* User info & actions */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${backendOnline === true ? 'bg-emerald-400' : backendOnline === false ? 'bg-rose-400' : 'bg-amber-400'}`}
              title={`Backend: ${backendOnline === true ? 'Online' : backendOnline === false ? 'Offline' : 'Checking…'}`}
            />
            {isOfflineMode && (
              <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">Offline</span>
            )}
            <span className="text-xs text-slate-400 hidden sm:block">{user?.name}</span>
            <button
              id="btn-settings"
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 text-slate-400 hover:text-slate-200 transition"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              id="btn-logout"
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-rose-400 transition"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        {/* ── HEATMAP TAB ── */}
        {activeTab === 'HEATMAP' && <WardInspectionDashboard />}

        {/* ── HISTORY TAB ── */}
        {activeTab === 'HISTORY' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  id="history-search"
                  type="text"
                  placeholder="Search by product name, barcode, inspector…"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadHistory()}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                id="btn-history-search"
                onClick={loadHistory}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold"
              >
                Search
              </button>
            </div>

            {historyRecords.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No inspection history yet. Scan a product to begin.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {historyRecords.map((record) => (
                  <div
                    key={record.id}
                    className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-4"
                  >
                    {record.image_thumbnail ? (
                      <img
                        src={record.image_thumbnail}
                        alt="thumbnail"
                        className="w-14 h-14 rounded-lg object-cover border border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        <Camera className="w-5 h-5 text-slate-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-slate-100 truncate">{record.product_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {new Date(record.timestamp).toLocaleString('en-IN')} · {record.inspector_name}
                      </p>
                      {record.barcode && <p className="text-xs font-mono text-slate-600 mt-0.5">{record.barcode}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-sm font-bold font-mono px-3 py-1 rounded-lg ${
                        record.passed / record.total >= 0.8 ? 'bg-emerald-500/15 text-emerald-400' :
                        record.passed / record.total >= 0.5 ? 'bg-amber-500/15 text-amber-400' :
                        'bg-rose-500/15 text-rose-400'
                      }`}>
                        {record.score}
                      </span>
                      <button
                        onClick={async () => {
                          await deleteInspection(record.id);
                          loadHistory();
                        }}
                        className="p-1.5 text-slate-600 hover:text-rose-400 transition"
                        title="Delete record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SCANNER TAB ── */}
        {activeTab === 'SCANNER' && (
          <div className="flex flex-col gap-6">
            {/* Control strip */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span className="text-xs text-slate-300">Cross-referencing with Central Legal Metrology Registry.</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleLoadOfflineDemo(false)} className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Compliant Demo
                </button>
                <button onClick={() => handleLoadOfflineDemo(true)} className="bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Violation Demo
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-500/40 rounded-xl flex items-center gap-3 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-auto"><X className="w-4 h-4" /></button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* ── Left panel ── */}
              <section className="lg:col-span-5 flex flex-col gap-5">
                {/* Multi-image upload */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <Images className="w-4 h-4 text-indigo-400" />
                      Multi-Photo Scan
                      <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">up to 5 photos</span>
                    </h2>
                    <div className="flex items-center gap-2">
                      {/* Force Gemini button — always runs Gemini Vision on existing images */}
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
                              const allScans: TaggedScan[] = [];
                              for (const r of results) {
                                if (r.success && r.data) {
                                  const geminiToks = geminiResultToTokens(r.data);
                                  // Also parse raw text as tesseract blocks for bounding boxes
                                  const rawBlocks: OCRBlock[] = (r.data.raw_extracted_text || '')
                                    .split('\n').filter((l: string) => l.trim().length > 0)
                                    .map((line: string, idx: number): OCRBlock => ({
                                      text: line.trim(),
                                      boundingBox: { x: 30, y: 35 + idx * 22, width: 300, height: 16 },
                                    }));
                                  allScans.push({ tokens: geminiToks, blocks: rawBlocks, source: 'gemini', imageIndex: r.imageIndex, confidence: 95 });
                                }
                              }
                              if (allScans.length > 0) {
                                setGeminiUsed(true);
                                const combinedRaw = allScans.map((s) => s.blocks.map((b) => b.text).join('\n')).join('\n');
                                setRawText(combinedRaw);
                                setDetectedBlocks(allScans.flatMap((s) => s.blocks));
                                await executeAudit(allScans, barcodeWidthPx, selectedBarcode, images);
                              }
                            } catch (err) {
                              console.error('Force Gemini failed:', err);
                            } finally {
                              setForceGeminiLoading(false);
                              setStatusMessage('');
                            }
                          }}
                          disabled={forceGeminiLoading}
                          className="bg-purple-600/80 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
                          title="Force Gemini Vision on all images (bypass Tesseract)"
                        >
                          {forceGeminiLoading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Brain className="w-3.5 h-3.5" />
                          )}
                          Gemini Vision
                        </button>
                      )}
                      <label
                        id="btn-upload"
                        className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition"
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

                  {/* Drop zone + image preview */}
                  <div
                    onDrop={handleFileDrop}
                    onDragOver={(e) => e.preventDefault()}
                    className="relative w-full h-64 bg-slate-950 border-2 border-dashed border-slate-700 hover:border-indigo-500/50 rounded-xl overflow-hidden flex items-center justify-center transition"
                  >
                    {isProcessing && (
                      <div className="absolute inset-0 bg-slate-950/90 z-10 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                        <p className="text-xs font-mono text-slate-300 text-center max-w-[200px]">{statusMessage}</p>
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
                      <div className="text-center text-slate-500 text-xs p-6">
                        <Upload className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                        <p className="font-semibold text-slate-400">Drop images here</p>
                        <p className="text-slate-600 mt-1">Or click "Add Photos" — front, back, sides</p>
                      </div>
                    )}
                  </div>

                  {/* Image thumbnail strip */}
                  {images.length > 0 && (
                    <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                      {images.map((img, idx) => (
                        <div
                          key={idx}
                          onClick={() => setActiveImageIdx(idx)}
                          className={`relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 cursor-pointer transition ${
                            activeImageIdx === idx ? 'border-indigo-500' : 'border-slate-700'
                          }`}
                        >
                          <img src={img.thumbnail || img.url} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                          {img.status === 'processing' && (
                            <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center">
                              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                            </div>
                          )}
                          {img.status === 'done' && (
                            <div className={`absolute bottom-0 left-0 right-0 text-[9px] font-mono text-center py-0.5 ${img.confidence >= 70 ? 'bg-emerald-500/80' : 'bg-amber-500/80'}`}>
                              {Math.round(img.confidence)}%
                            </div>
                          )}
                          {img.status === 'error' && (
                            <div className="absolute inset-0 bg-rose-950/60 flex items-center justify-center">
                              <XCircle className="w-4 h-4 text-rose-400" />
                            </div>
                          )}
                          {/* Remove button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setImages((prev) => prev.filter((_, i) => i !== idx));
                              if (activeImageIdx >= idx) setActiveImageIdx(Math.max(0, idx - 1));
                            }}
                            className="absolute top-0.5 right-0.5 w-4 h-4 bg-rose-500 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition"
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                      <label className="shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-slate-700 hover:border-indigo-500/50 flex items-center justify-center cursor-pointer transition">
                        <Plus className="w-5 h-5 text-slate-600" />
                        <input type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
                      </label>
                    </div>
                  )}
                </div>

                {/* GS1 Barcode + Registry */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <Barcode className="w-4 h-4 text-emerald-400" />
                      GS1 Barcode & Registry Anchor
                    </h2>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">37.29mm</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mb-2.5 leading-relaxed">
                    📐 <strong>Optical Metric Calibration:</strong> An EAN-13 barcode has an international nominal width of <strong>37.29mm</strong>. This slider calibrates photo pixels to real millimeters, enabling the engine to verify <strong>Rule 7 Table I (Minimum Font Height)</strong> on mandatory numerals without requiring physical calipers.
                  </p>
                  <label className="text-xs text-slate-400 block mb-1 font-medium">Scanned EAN-13 Benchmark:</label>
                  <select
                    value={selectedBarcode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedBarcode(val);
                      if (detectedBlocks.length > 0) {
                        const scan: TaggedScan = { tokens: LegalMetrologyEngine.parseTokens(detectedBlocks), blocks: detectedBlocks, source: 'tesseract', imageIndex: 0, confidence: 80 };
                        executeAudit([scan], barcodeWidthPx, val, images);
                      }
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 mb-3"
                  >
                    {Object.values(NATIONAL_COMMODITY_REGISTRY).map((b) => (
                      <option key={b.barcode} value={b.barcode}>
                        {b.barcode} — {b.brandName} (₹{b.authorizedStandardMRP}, {b.standardNetQuantity}{b.standardUnit})
                      </option>
                    ))}
                  </select>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Barcode Optical Pixel Width:</span>
                    <span className="font-mono text-emerald-400 font-bold">{barcodeWidthPx}px</span>
                  </div>
                  <input
                    type="range" min="180" max="650" value={barcodeWidthPx}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBarcodeWidthPx(val);
                      if (detectedBlocks.length > 0) {
                        const scan: TaggedScan = { tokens: LegalMetrologyEngine.parseTokens(detectedBlocks), blocks: detectedBlocks, source: 'tesseract', imageIndex: 0, confidence: 80 };
                        executeAudit([scan], val, selectedBarcode, images);
                      }
                    }}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-400 mt-1 font-mono">
                    <span>180px</span>
                    <span className="text-emerald-400 font-semibold">Scale: {(barcodeWidthPx / 37.29).toFixed(2)} px/mm</span>
                    <span>650px</span>
                  </div>
                </div>

                {/* Raw text editor */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                  <label className="text-xs font-mono text-slate-400 mb-2 block">Extracted OCR Text (editable):</label>
                  <textarea
                    rows={5}
                    value={rawText}
                    placeholder="Extracted label text appears here…"
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 leading-relaxed resize-none"
                  />
                  <button
                    id="btn-reaudit"
                    onClick={handleManualReAudit}
                    className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2 text-xs transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Re-audit Extracted Tokens
                  </button>
                </div>
              </section>

              {/* ── Right panel ── */}
              <section className="lg:col-span-7 flex flex-col gap-5">
                {/* Rule 18 Price Intelligence */}
                {anomalyResult && (
                  <div className={`p-5 rounded-xl border ${
                    anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                      ? 'bg-rose-950/30 border-rose-500/50 text-rose-200 ring-1 ring-rose-500/30'
                      : 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                  }`}>
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <h3 className="text-sm font-bold flex items-center gap-2 font-mono">
                        <TrendingUp className="w-4 h-4" /> Rule 18 Price Intelligence
                      </h3>
                      <span className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded ${
                        anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      }`}>
                        {anomalyResult.isDualMRP || anomalyResult.isShrinkflated ? 'ANOMALY DETECTED' : 'BENCHMARK COMPLIANT'}
                      </span>
                    </div>
                    <p className="text-xs mt-3 leading-relaxed">{anomalyResult.narrative}</p>
                    <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t border-white/10 font-mono text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">DUAL-MRP MARKUP</span>
                        <span className={`font-bold ${anomalyResult.isDualMRP ? 'text-rose-400' : 'text-slate-200'}`}>
                          {anomalyResult.isDualMRP ? `+${anomalyResult.mrpMarkupPercent.toFixed(1)}%` : '0% (Standard)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">GRAMMAGE DEFICIT</span>
                        <span className={`font-bold ${anomalyResult.isShrinkflated ? 'text-rose-400' : 'text-slate-200'}`}>
                          {anomalyResult.isShrinkflated ? `-${anomalyResult.grammageReductionPercent.toFixed(1)}%` : '0% (Standard)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">STEALTH HIKE</span>
                        <span className={`font-bold ${anomalyResult.effectiveStealthHikePercent > 0 ? 'text-amber-400' : 'text-slate-200'}`}>
                          {anomalyResult.effectiveStealthHikePercent > 0 ? `+${anomalyResult.effectiveStealthHikePercent.toFixed(1)}%/g` : 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Compliance checklist */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-slate-800 gap-3">
                    <div>
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Scale className="w-5 h-5 text-amber-400" />
                        Statutory 18-Rule Compliance Checklist
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">Legal Metrology (Packaged Commodities) Rules, 2011</p>
                    </div>
                    {report && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
                          Score: <strong className="text-emerald-400">{report.score}</strong>
                        </span>
                        <button
                          id="btn-download-pdf"
                          onClick={handleDownloadNotice}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs transition"
                        >
                          <FileDown className="w-4 h-4" /> PDF
                        </button>
                        <button
                          id="btn-export-json"
                          onClick={() => report && exportReportAsJSON(report)}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs transition"
                        >
                          <Download className="w-3.5 h-3.5" /> JSON
                        </button>
                        <button
                          id="btn-export-csv"
                          onClick={() => report && exportReportAsCSV(report)}
                          className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs transition"
                        >
                          <Download className="w-3.5 h-3.5" /> CSV
                        </button>
                      </div>
                    )}
                  </div>

                  {!report ? (
                    <div className="text-center py-24 text-slate-500 text-sm">
                      <Camera className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p>Upload product photos or use a demo preset to run the compliance audit.</p>
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {report.results.map((res: RuleCheckResult, i: number) => (
                        <div
                          key={i}
                          className={`p-4 rounded-xl border transition-all ${
                            res.isCoreInnovation
                              ? 'bg-indigo-950/25 border-indigo-500/50 shadow-sm ring-1 ring-indigo-500/20'
                              : res.status === 'PASS'
                              ? 'bg-slate-950/40 border-slate-800 text-slate-300'
                              : res.status === 'WARNING'
                              ? 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                              : 'bg-rose-950/20 border-rose-500/30 text-rose-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3">
                              {res.status === 'PASS' ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                              ) : res.status === 'WARNING' ? (
                                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm text-slate-100 font-mono">{res.ruleId}</span>
                                  <span className="text-xs text-slate-400">• {res.description}</span>
                                  {res.isCoreInnovation && (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full">
                                      <Zap className="w-3 h-3" />{res.innovationBadge}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs mt-1 text-slate-300 leading-relaxed">{res.details}</p>
                              </div>
                            </div>
                            <span className={`text-xs px-2 py-0.5 font-mono font-semibold rounded shrink-0 ${
                              res.status === 'PASS'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : res.status === 'WARNING'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            }`}>
                              {res.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
