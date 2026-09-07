import React, { useState, useRef } from 'react';
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
  Sparkles,
  Zap,
  Map,
  ScanLine,
  TrendingUp,
  Layers,
} from 'lucide-react';
import Tesseract from 'tesseract.js';
import { MetricFiducialEngine, LegalMetrologyEngine } from './engine';
import type { OCRBlock, ComplianceReport, RuleCheckResult } from './engine';
import { generateImprovementNoticePDF } from './pdfGenerator';
import { WardInspectionDashboard } from './WardMap';
import {
  NATIONAL_COMMODITY_REGISTRY,
  evaluatePriceAndGrammageAnomalies,
  type AnomalyVerdict,
} from './registryData';

export default function App() {
  const [activeTab, setActiveTab] = useState<'SCANNER' | 'HEATMAP'>('SCANNER');
  const [barcodeWidthPx, setBarcodeWidthPx] = useState<number>(320);
  const [selectedBarcode, setSelectedBarcode] = useState<string>('8901491101895');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [scaleRatio, setScaleRatio] = useState<number>(0);
  const [detectedBlocks, setDetectedBlocks] = useState<OCRBlock[]>([]);
  const [anomalyResult, setAnomalyResult] = useState<AnomalyVerdict | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const executeAudit = (blocks: OCRBlock[], barcodePx: number, barcodeStr: string) => {
    const calibration = MetricFiducialEngine.calibrate(barcodePx);
    setScaleRatio(calibration.pixelsPerMm);

    const tokens = LegalMetrologyEngine.parseTokens(blocks);
    const auditReport = LegalMetrologyEngine.audit(tokens, calibration);
    setReport(auditReport);

    if (tokens.mrp && tokens.netQuantity) {
      const anomaly = evaluatePriceAndGrammageAnomalies(
        barcodeStr,
        tokens.mrp.value,
        tokens.netQuantity.value
      );
      setAnomalyResult(anomaly);
    } else {
      setAnomalyResult(null);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const imageUrl = URL.createObjectURL(file);
    setSelectedImage(imageUrl);
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage('Initializing OCR engine...');
    setReport(null);

    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setStatusMessage(`Reading text: ${Math.round((m.progress || 0) * 100)}%`);
          } else {
            setStatusMessage(`${m.status}...`);
          }
        },
      });

      const extractedText = (result.data.text || '').trim();
      setRawText(extractedText);

      const pageData = result.data as any;
      let blocks: OCRBlock[] = [];

      if (Array.isArray(pageData.lines) && pageData.lines.length > 0) {
        blocks = pageData.lines
          .map((line: any): OCRBlock => ({
            text: (line.text || '').trim(),
            boundingBox: {
              x: line.bbox?.x0 ?? 30,
              y: line.bbox?.y0 ?? 30,
              width: (line.bbox?.x1 ?? 200) - (line.bbox?.x0 ?? 30),
              height: (line.bbox?.y1 ?? 50) - (line.bbox?.y0 ?? 30),
            },
          }))
          .filter((b: OCRBlock) => b.text.length > 0);
      }

      if (blocks.length === 0) {
        const textLines = extractedText.split('\n').filter((l: string) => l.trim().length > 0);
        blocks = textLines.map((line: string, idx: number): OCRBlock => ({
          text: line.trim(),
          boundingBox: {
            x: 30,
            y: 40 + idx * 32,
            width: 260,
            height: line.includes('MRP') ? 22 : 14,
          },
        }));
      }

      setDetectedBlocks(blocks);
      drawBoundingBoxes(blocks, imageUrl);
      executeAudit(blocks, barcodeWidthPx, selectedBarcode);
    } catch (err: any) {
      console.error('OCR Error:', err);
      setErrorMessage(
        err.message || 'Failed to download OCR language model. Try the offline demo button below.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadOfflineDemo = (simulateViolation: boolean = false) => {
    setErrorMessage(null);

    const sampleText = simulateViolation
      ? "Kurkure Masala Munch (Extruded Snack)\n" +
        "Mfg by PepsiCo India Holdings Pvt Ltd, Village Channo, Sangrur, Punjab\n" +
        "Net Wt: 130 g\n" +
        "MFD: 08/2026\n" +
        "Best Before 6 Months from Mfg\n" +
        "MRP Rs. 45.00 incl. of all taxes\n" +
        "USP Rs. 0.35 per g\n" +
        "Country of Origin: Made in India\n" +
        "Consumer Care: 1800 22 4020, feedback@pepsico.com\n" +
        "FSSAI Lic No: 10014011001895"
      : "Kurkure Masala Munch (Extruded Snack)\n" +
        "Mfg by PepsiCo India Holdings Pvt Ltd, Village Channo, Sangrur, Punjab\n" +
        "Net Wt: 150 g\n" +
        "MFD: 08/2026\n" +
        "Best Before 6 Months from Mfg\n" +
        "MRP Rs. 30.00 incl. of all taxes\n" +
        "USP Rs. 0.20 per g\n" +
        "Country of Origin: Made in India\n" +
        "Consumer Care: 1800 22 4020, feedback@pepsico.com\n" +
        "FSSAI Lic No: 10014011001895";

    setRawText(sampleText);

    const lines = sampleText.split('\n');
    const mockBlocks: OCRBlock[] = lines.map((line: string, idx: number): OCRBlock => ({
      text: line,
      boundingBox: {
        x: 35,
        y: 35 + idx * 28,
        width: 380,
        height: line.includes('MRP') ? 22 : 13,
      },
    }));

    setDetectedBlocks(mockBlocks);
    setSelectedImage(null);
    executeAudit(mockBlocks, barcodeWidthPx, selectedBarcode);

    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = 520;
        canvas.height = 360;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        mockBlocks.forEach((b: OCRBlock) => {
          const isInnovation = b.text.includes('MRP') || b.text.includes('USP');
          ctx.strokeStyle = isInnovation ? '#38bdf8' : '#34d399';
          ctx.lineWidth = 2;
          ctx.fillStyle = isInnovation ? 'rgba(56, 189, 248, 0.25)' : 'rgba(52, 211, 153, 0.1)';
          ctx.strokeRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
          ctx.fillRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
        });
      }
    }
  };

  const handleManualReAudit = () => {
    const lines = rawText.split('\n').filter((l) => l.trim().length > 0);
    const mockBlocks: OCRBlock[] = lines.map((line, idx): OCRBlock => ({
      text: line,
      boundingBox: {
        x: 30,
        y: 35 + idx * 28,
        width: 320,
        height: line.includes('MRP') ? 22 : 14,
      },
    }));
    setDetectedBlocks(mockBlocks);
    executeAudit(mockBlocks, barcodeWidthPx, selectedBarcode);
  };

  const handleDownloadNotice = () => {
    if (!report) return;
    generateImprovementNoticePDF(report, selectedImage, scaleRatio, rawText);
  };

  const drawBoundingBoxes = (blocks: OCRBlock[], imgUrl: string) => {
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

      blocks.forEach((b: OCRBlock) => {
        const isCore = /(MRP|USP)/i.test(b.text);
        ctx.strokeStyle = isCore ? '#38bdf8' : '#34d399';
        ctx.lineWidth = 3;
        ctx.fillStyle = isCore ? 'rgba(56, 189, 248, 0.25)' : 'rgba(52, 211, 153, 0.1)';
        ctx.strokeRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
        ctx.fillRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
      });
    };
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <h1 className="text-2xl font-bold tracking-tight">CompliScan</h1>
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-mono font-semibold">
              SIH26034 Prototype
            </span>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2.5 py-1 rounded-full font-mono">
              Dual-MRP & Shrinkflation Module
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Automated Legal Metrology Compliance, In-Plane Optical Ruler & Retail Intelligence
          </p>
        </div>

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('SCANNER')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'SCANNER'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ScanLine className="w-4 h-4" /> Packaging Scanner
          </button>
          <button
            onClick={() => setActiveTab('HEATMAP')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'HEATMAP'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Map className="w-4 h-4" /> Ward Heatmap (GIS)
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto mt-6">
        {activeTab === 'HEATMAP' ? (
          <WardInspectionDashboard />
        ) : (
          <div className="flex flex-col gap-6">
            {/* Control Action Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-slate-900/60 border border-slate-800 rounded-xl p-3.5 gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span className="text-xs text-slate-300">
                  Cross-referencing scanned commodities with Central Legal Metrology Registry benchmarks.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleLoadOfflineDemo(false)}
                  className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Compliant Pack
                </button>
                <button
                  onClick={() => handleLoadOfflineDemo(true)}
                  className="bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Simulate Dual-MRP & Shrinkflation
                </button>
              </div>
            </div>

            {errorMessage && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-500/40 rounded-xl flex items-center justify-between gap-3 text-rose-300 text-xs">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
                <button
                  onClick={() => handleLoadOfflineDemo(false)}
                  className="underline hover:text-rose-100 font-semibold"
                >
                  Switch to Offline Demo
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: Image Canvas & Barcode Lookup */}
              <section className="lg:col-span-5 flex flex-col gap-6">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <Camera className="w-4 h-4 text-indigo-400" />
                      Packaging View & OCR Detection
                    </h2>
                    <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
                      <Upload className="w-3.5 h-3.5" /> Scan Real Package
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>

                  <div className="relative w-full h-72 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center">
                    {isProcessing && (
                      <div className="absolute inset-0 bg-slate-950/85 z-10 flex flex-col items-center justify-center gap-3">
                        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                        <p className="text-xs font-mono text-slate-300 uppercase tracking-wide">
                          {statusMessage}
                        </p>
                      </div>
                    )}

                    {selectedImage ? (
                      <img src={selectedImage} alt="Package" className="absolute inset-0 w-full h-full object-contain" />
                    ) : (
                      <div className="text-center text-slate-500 text-xs p-6">
                        <p className="font-semibold text-slate-400">No Image Uploaded</p>
                        <p className="text-slate-600 mt-1">Click "Scan Real Package" or select a demo preset above.</p>
                      </div>
                    )}
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                  </div>
                </div>

                {/* Barcode Fiducial & National Registry Selector */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-base font-semibold flex items-center gap-2">
                      <Barcode className="w-4 h-4 text-emerald-400" />
                      GS1 Barcode & Registry Anchor
                    </h2>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                      Nominal 37.29 mm
                    </span>
                  </div>

                  <label className="text-xs text-slate-400 block mb-1">
                    Select Scanned EAN-13 Barcode Benchmark:
                  </label>
                  <select
                    value={selectedBarcode}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedBarcode(val);
                      if (detectedBlocks.length > 0) executeAudit(detectedBlocks, barcodeWidthPx, val);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 mb-4"
                  >
                    {Object.values(NATIONAL_COMMODITY_REGISTRY).map((b) => (
                      <option key={b.barcode} value={b.barcode}>
                        {b.barcode} — {b.brandName} (Base: ₹{b.authorizedStandardMRP}, {b.standardNetQuantity}{b.standardUnit})
                      </option>
                    ))}
                  </select>

                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Optical Pixel Width on Camera:</span>
                    <span className="font-mono text-emerald-400 font-bold">{barcodeWidthPx} px</span>
                  </div>
                  <input
                    type="range"
                    min="180"
                    max="650"
                    value={barcodeWidthPx}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBarcodeWidthPx(val);
                      if (detectedBlocks.length > 0) executeAudit(detectedBlocks, val, selectedBarcode);
                    }}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 mt-2 font-mono">
                    <span>180px</span>
                    <span>Scale: {scaleRatio > 0 ? scaleRatio.toFixed(2) : '--'} px/mm</span>
                    <span>650px</span>
                  </div>
                </div>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                  <label className="text-xs font-mono text-slate-400 mb-2 block">
                    Extracted Packaging Tokens (Raw OCR):
                  </label>
                  <textarea
                    rows={5}
                    value={rawText}
                    placeholder="Extracted label text appears here..."
                    onChange={(e) => setRawText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500 leading-relaxed"
                  />
                  <button
                    onClick={handleManualReAudit}
                    className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2 px-4 rounded-lg flex items-center justify-center gap-2 text-xs transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Re-audit Extracted Tokens
                  </button>
                </div>
              </section>

              {/* Right Column: Statutory 10-Declaration Verdict & Anomaly Intelligence */}
              <section className="lg:col-span-7 flex flex-col gap-6">
                {/* Dual-MRP & Shrinkflation Intelligence Card */}
                {anomalyResult && (
                  <div
                    className={`p-5 rounded-xl border ${
                      anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                        ? 'bg-rose-950/30 border-rose-500/50 text-rose-200 ring-1 ring-rose-500/30'
                        : 'bg-emerald-950/20 border-emerald-500/40 text-emerald-200'
                    }`}
                  >
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <h3 className="text-sm font-bold flex items-center gap-2 font-mono">
                        <TrendingUp className="w-4 h-4" />
                        Rule 18 Price Intelligence & Benchmark Audit
                      </h3>
                      <span
                        className={`text-xs font-mono font-bold px-2.5 py-0.5 rounded ${
                          anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        }`}
                      >
                        {anomalyResult.isDualMRP || anomalyResult.isShrinkflated
                          ? 'ANOMALY DETECTED'
                          : 'BENCHMARK COMPLIANT'}
                      </span>
                    </div>

                    <p className="text-xs mt-3 leading-relaxed font-sans">{anomalyResult.narrative}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-3 border-t border-white/10 font-mono text-xs">
                      <div>
                        <span className="text-slate-400 block text-[11px]">DUAL-MRP MARKUP</span>
                        <span
                          className={`font-bold ${
                            anomalyResult.isDualMRP ? 'text-rose-400' : 'text-slate-200'
                          }`}
                        >
                          {anomalyResult.isDualMRP ? `+${anomalyResult.mrpMarkupPercent.toFixed(1)}%` : '0% (Standard)'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">GRAMMAGE DEFICIT</span>
                        <span
                          className={`font-bold ${
                            anomalyResult.isShrinkflated ? 'text-rose-400' : 'text-slate-200'
                          }`}
                        >
                          {anomalyResult.isShrinkflated
                            ? `-${anomalyResult.grammageReductionPercent.toFixed(1)}%`
                            : '0% (Standard)'}
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-400 block text-[11px]">EFFECTIVE STEALTH HIKE</span>
                        <span
                          className={`font-bold ${
                            anomalyResult.effectiveStealthHikePercent > 0
                              ? 'text-amber-400'
                              : 'text-slate-200'
                          }`}
                        >
                          {anomalyResult.effectiveStealthHikePercent > 0
                            ? `+${anomalyResult.effectiveStealthHikePercent.toFixed(1)}% / g`
                            : 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Standard Statutory 10-Declaration Checklist */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-4 border-b border-slate-800 gap-3">
                    <div>
                      <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Scale className="w-5 h-5 text-amber-400" />
                        Statutory 10-Declaration Checklist
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Legal Metrology (Packaged Commodities) Rules, 2011
                      </p>
                    </div>

                    {report && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
                          Score: <strong className="text-emerald-400">{report.score}</strong>
                        </span>
                        <button
                          onClick={handleDownloadNotice}
                          className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs transition shadow-sm"
                        >
                          <FileDown className="w-4 h-4" /> Download Notice (PDF)
                        </button>
                      </div>
                    )}
                  </div>

                  {!report ? (
                    <div className="text-center py-28 text-slate-500 text-sm">
                      Select a demo preset above or upload an image to run the statutory audit and Rule 18 price cross-check.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3.5">
                      {report.results.map((res: RuleCheckResult, i: number) => {
                        const isCore = res.isCoreInnovation;
                        return (
                          <div
                            key={i}
                            className={`p-4 rounded-xl border transition-all ${
                              isCore
                                ? 'bg-indigo-950/25 border-indigo-500/50 shadow-sm ring-1 ring-indigo-500/20'
                                : res.status === 'PASS'
                                ? 'bg-slate-950/40 border-slate-800 text-slate-300'
                                : res.status === 'WARNING'
                                ? 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                                : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                {res.status === 'PASS' ? (
                                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                                ) : res.status === 'WARNING' ? (
                                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                                ) : (
                                  <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                                )}
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sm text-slate-100 font-mono">
                                      {res.ruleId}
                                    </span>
                                    <span className="text-xs text-slate-400 font-normal">
                                      • {res.description}
                                    </span>
                                    {isCore && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-2 py-0.5 rounded-full">
                                        <Zap className="w-3 h-3 text-indigo-400" />
                                        {res.innovationBadge}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs mt-1.5 text-slate-300 font-sans leading-relaxed">
                                    {res.details}
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`text-xs px-2.5 py-0.5 font-mono font-semibold rounded shrink-0 ${
                                  res.status === 'PASS'
                                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                    : res.status === 'WARNING'
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {res.status}
                              </span>
                            </div>
                          </div>
                        );
                      })}
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
