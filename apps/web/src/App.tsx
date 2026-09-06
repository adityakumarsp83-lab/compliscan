import React, { useState, useRef } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Camera, Barcode, Scale, RefreshCw, Upload } from 'lucide-react';
import { MetricFiducialEngine, LegalMetrologyEngine } from './engine';
import type { OCRBlock, ComplianceReport } from './engine';

export default function App() {
  const [barcodeWidthPx, setBarcodeWidthPx] = useState<number>(320);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>(
    "Kurkure Masala Munch\nNet Wt: 150 g\nMRP Rs. 30.00 incl. of all taxes\nUSP Rs. 0.20 per g\nFSSAI Lic No: 10014011001895\nCustomer Care: 1800 22 4020\nMade in India"
  );
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [scaleRatio, setScaleRatio] = useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Handle uploaded product packaging image
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setSelectedImage(url);
    }
  };

  const handleRunAudit = () => {
    // 1. Metric Calibration via GS1 Barcode standard width (37.29 mm)
    const calibration = MetricFiducialEngine.calibrate(barcodeWidthPx);
    setScaleRatio(calibration.pixelsPerMm);

    // 2. Parse text blocks with simulated bounding coordinates
    const lines = rawText.split('\n').filter((l: string) => l.trim().length > 0);
    const mockBlocks: OCRBlock[] = lines.map((line: string, idx: number) => ({
      text: line,
      boundingBox: {
        x: 30,
        y: 40 + idx * 36,
        width: 280,
        height: line.includes("MRP") ? 20 : 14,
      },
    }));

    // 3. Draw bounding boxes over canvas image
    drawBoundingBoxes(mockBlocks);

    // 4. Run statutory audit against Rule 6 and Rule 7
    const tokens = LegalMetrologyEngine.parseTokens(mockBlocks);
    const auditReport = LegalMetrologyEngine.audit(tokens, calibration);
    setReport(auditReport);
  };

  const drawBoundingBoxes = (blocks: OCRBlock[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear previous drawing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw detected token bounding boxes
    blocks.forEach((b) => {
      const isMrp = b.text.includes("MRP");
      ctx.strokeStyle = isMrp ? '#38bdf8' : '#34d399';
      ctx.lineWidth = 2;
      ctx.fillStyle = isMrp ? 'rgba(56, 189, 248, 0.15)' : 'rgba(52, 211, 153, 0.1)';

      ctx.strokeRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);
      ctx.fillRect(b.boundingBox.x, b.boundingBox.y, b.boundingBox.width, b.boundingBox.height);

      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText(b.text.slice(0, 24), b.boundingBox.x + 2, b.boundingBox.y - 4);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans">
      {/* Header */}
      <header className="max-w-7xl mx-auto flex justify-between items-center pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
            <h1 className="text-2xl font-bold tracking-tight">CompliScan</h1>
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full font-mono">
              SIH26034 Prototype
            </span>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            Automated Legal Metrology Compliance & In-Plane Metric Ruler Engine
          </p>
        </div>
      </header>

      {/* Main Grid */}
      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 mt-8">
        {/* Left Column: Visual Scanner & Calibration */}
        <section className="lg:col-span-6 flex flex-col gap-6">
          {/* Packaging Image & Canvas View */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Camera className="w-4 h-4 text-indigo-400" />
                Physical Packaging View
              </h2>
              <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition">
                <Upload className="w-3.5 h-3.5" /> Upload Pack Image
                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
              </label>
            </div>

            <div className="relative w-full h-80 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex items-center justify-center">
              {selectedImage ? (
                <img src={selectedImage} alt="Package" className="absolute inset-0 w-full h-full object-contain" />
              ) : (
                <div className="text-center text-slate-500 text-xs">
                  <p>No package image selected.</p>
                  <p className="text-slate-600 mt-1">Upload a photo or run audit using default bounding boxes.</p>
                </div>
              )}
              <canvas ref={canvasRef} width={500} height={320} className="absolute inset-0 w-full h-full pointer-events-none" />
            </div>
          </div>

          {/* Metric Ruler Slider */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <h2 className="text-base font-semibold flex items-center gap-2 mb-3">
              <Barcode className="w-4 h-4 text-emerald-400" />
              In-Plane Barcode Fiducial Calibration
            </h2>
            <div className="flex justify-between text-xs text-slate-300 mb-1">
              <span>Detected GS1 Barcode Width on Camera:</span>
              <span className="font-mono text-emerald-400 font-bold">{barcodeWidthPx} px</span>
            </div>
            <input
              type="range"
              min="180"
              max="550"
              value={barcodeWidthPx}
              onChange={(e) => setBarcodeWidthPx(Number(e.target.value))}
              className="w-full accent-emerald-400 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] text-slate-500 mt-2 font-mono">
              <span>Low-res (180px)</span>
              <span>GS1 Standard: 37.29mm</span>
              <span>High-res (550px)</span>
            </div>
          </div>

          {/* Text Tokens Editor */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <label className="text-xs font-mono text-slate-400 mb-2 block">
              Recognized Label Text (OCR Tokens):
            </label>
            <textarea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              onClick={handleRunAudit}
              className="w-full mt-4 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-4 h-4" /> Run Statutory Compliance Audit
            </button>
          </div>
        </section>

        {/* Right Column: Statutory Audit & Legal Metrology Verdict */}
        <section className="lg:col-span-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-400" />
                Statutory Compliance Verdict
              </h2>
              {report && (
                <div className="text-sm font-mono px-3 py-1 bg-slate-800 rounded-full">
                  Score: <strong className="text-emerald-400">{report.score}</strong>
                </div>
              )}
            </div>

            {!report ? (
              <div className="text-center py-24 text-slate-500 text-sm">
                Click <strong className="text-slate-400">"Run Statutory Compliance Audit"</strong> to evaluate the declarations against Rule 6 and Rule 7.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {/* Metric Telemetry */}
                <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 text-xs font-mono flex justify-between text-slate-400">
                  <span>Scale Ratio: <strong className="text-slate-200">{scaleRatio.toFixed(2)} px/mm</strong></span>
                  <span>GS1 Barcode Standard: <strong className="text-slate-200">37.29 mm</strong></span>
                </div>

                {/* Audit Checklist */}
                <div className="space-y-3">
                  {report.results.map((res, i) => (
                    <div
                      key={i}
                      className={`p-4 rounded-lg border flex items-start justify-between gap-4 ${
                        res.status === 'PASS'
                          ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {res.status === 'PASS' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <div className="font-semibold text-sm text-slate-100 flex items-center gap-2">
                            <span>{res.ruleId}</span>
                            <span className="text-xs text-slate-400 font-normal">({res.description})</span>
                          </div>
                          <p className="text-xs mt-1 text-slate-300">{res.details}</p>
                        </div>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 font-mono rounded ${
                          res.status === 'PASS'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {res.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
