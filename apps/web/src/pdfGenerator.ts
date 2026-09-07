import { jsPDF } from 'jspdf';
import type { ComplianceReport } from './engine';

// ── PDF Report Generation ────────────────────────────────────────────────────

export function generateImprovementNoticePDF(
  report: ComplianceReport,
  imageDataUrls: string[],
  scaleRatio: number,
  _rawText: string
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const noticeId = `IN-2026-${Math.floor(100000 + Math.random() * 900000)}`;
  const inspectionDate = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });

  // 1. Header banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('GOVERNMENT OF INDIA', pageWidth / 2, 10, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('MINISTRY OF CONSUMER AFFAIRS, FOOD & PUBLIC DISTRIBUTION', pageWidth / 2, 16, { align: 'center' });
  doc.text('DIRECTORATE OF LEGAL METROLOGY — FIELD ENFORCEMENT WING', pageWidth / 2, 21, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(56, 189, 248);
  doc.text('STATUTORY IMPROVEMENT NOTICE (FORM A-1)', pageWidth / 2, 27, { align: 'center' });

  // Legal reference sub-header
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.text(
    'Issued under Section 36 of Legal Metrology Act, 2009 | Legal Metrology (Packaged Commodities) Rules, 2011',
    pageWidth / 2, 37, { align: 'center' }
  );
  doc.setDrawColor(203, 213, 225);
  doc.line(14, 40, pageWidth - 14, 40);

  // 2. Inspection metadata box
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, 43, pageWidth - 28, 28, 2, 2, 'F');
  doc.rect(14, 43, pageWidth - 28, 28, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Notice Ref:', 18, 49); doc.setFont('helvetica', 'normal'); doc.text(noticeId, 45, 49);
  doc.setFont('helvetica', 'bold'); doc.text('Timestamp:', 18, 55); doc.setFont('helvetica', 'normal'); doc.text(inspectionDate, 45, 55);
  doc.setFont('helvetica', 'bold'); doc.text('Score:', 18, 61);
  doc.setFont('helvetica', 'bold');
  const scoreRatio = report.totalPassed / report.totalRules;
  doc.setTextColor(scoreRatio >= 0.8 ? 22 : scoreRatio >= 0.5 ? 180 : 225, scoreRatio >= 0.8 ? 101 : scoreRatio >= 0.5 ? 100 : 29, scoreRatio >= 0.8 ? 52 : scoreRatio >= 0.5 ? 20 : 72);
  doc.text(`${report.score} Statutory Declarations Met`, 45, 61);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold'); doc.text('Optical Scale:', 110, 49); doc.setFont('helvetica', 'normal'); doc.text(`${scaleRatio.toFixed(2)} px/mm`, 140, 49);
  doc.setFont('helvetica', 'bold'); doc.text('OCR Pipeline:', 110, 55); doc.setFont('helvetica', 'normal'); doc.text('Tesseract v5 LSTM + Gemini 1.5 Flash', 140, 55);

  // 3. Multi-photo evidence grid
  let currentY = 76;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Photographic Evidence', 14, currentY);
  currentY += 4;

  const validImages = imageDataUrls.filter((url) => url && url.startsWith('http'));
  if (validImages.length > 0) {
    const cols = Math.min(validImages.length, 3);
    const imgW = (pageWidth - 28 - (cols - 1) * 3) / cols;
    const imgH = imgW * 0.75;
    validImages.slice(0, 6).forEach((url, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 14 + col * (imgW + 3);
      const y = currentY + row * (imgH + 3);
      try {
        doc.addImage(url, 'JPEG', x, y, imgW, imgH, undefined, 'FAST');
        doc.setDrawColor(148, 163, 184);
        doc.rect(x, y, imgW, imgH);
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`Photo ${idx + 1}`, x + 1, y + imgH - 1);
      } catch { /* skip bad image */ }
    });
    const rows = Math.ceil(Math.min(validImages.length, 6) / cols);
    currentY += rows * (imgH + 3) + 5;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('[Digital evidence captured on-device. No image data in export.]', 14, currentY + 4);
    currentY += 10;
  }

  // 4. Statutory findings checklist
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Statutory Findings & 18-Rule Non-Compliance Checklist', 14, currentY);
  currentY += 5;

  // Table header
  doc.setFillColor(226, 232, 240);
  doc.rect(14, currentY, pageWidth - 28, 7, 'F');
  doc.rect(14, currentY, pageWidth - 28, 7, 'S');
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text('RULE', 17, currentY + 4.5);
  doc.text('DECLARATION', 45, currentY + 4.5);
  doc.text('STATUS', 118, currentY + 4.5);
  doc.text('FINDING', 138, currentY + 4.5);
  currentY += 7;

  report.results.forEach((item) => {
    if (currentY > 265) {
      doc.addPage();
      currentY = 20;
    }
    const isPass = item.status === 'PASS';
    const isWarn = item.status === 'WARNING';
    doc.setFillColor(isPass ? 240 : isWarn ? 254 : 254, isPass ? 253 : isWarn ? 243 : 242, isPass ? 244 : isWarn ? 199 : 242);
    doc.rect(14, currentY, pageWidth - 28, 6.5, 'F');
    doc.rect(14, currentY, pageWidth - 28, 6.5, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(30, 41, 59);
    doc.text(item.ruleId.slice(0, 16), 17, currentY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.text(item.description.slice(0, 32), 45, currentY + 4.3);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(isPass ? 22 : isWarn ? 146 : 225, isPass ? 101 : isWarn ? 64 : 29, isPass ? 52 : isWarn ? 14 : 72);
    doc.text(item.status, 118, currentY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(item.details.slice(0, 36), 138, currentY + 4.3);
    currentY += 6.5;
  });

  // 5. Statutory directive box
  currentY += 5;
  if (currentY > 235) { doc.addPage(); currentY = 20; }
  doc.setFillColor(254, 243, 199);
  doc.roundedRect(14, currentY, pageWidth - 28, 30, 1.5, 1.5, 'F');
  doc.setDrawColor(245, 158, 11);
  doc.rect(14, currentY, pageWidth - 28, 30, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(146, 64, 14);
  doc.text('STATUTORY DIRECTIVE — LEGAL METROLOGY ACT, 2009 — SECTION 36:', 18, currentY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 53, 15);
  const directive = 'Procedural labeling contraventions under Rules 6 & 7 of the Legal Metrology (Packaged Commodities) Rules, 2011 are subject to a mandatory 21-DAY IMPROVEMENT PERIOD. The manufacturer/packer is directed to rectify all highlighted non-compliances or show cause within 21 days. Failure to rectify shall trigger administrative penalty under Section 36 (Fine: up to ₹4,000).';
  doc.text(doc.splitTextToSize(directive, pageWidth - 36), 18, currentY + 12);

  // 6. Footer
  currentY += 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Digitally authenticated by CompliScan Field Enforcement Suite v2.0 | SIH-26034', 14, currentY);
  doc.text('[Seal of Legal Metrology Officer]', pageWidth - 60, currentY);

  doc.save(`CompliScan_Notice_${noticeId}.pdf`);
}

// ── JSON Export ───────────────────────────────────────────────────────────────

export function exportReportAsJSON(report: ComplianceReport): void {
  const exportData = {
    exportedAt: new Date().toISOString(),
    complianceSummary: {
      score: report.score,
      totalPassed: report.totalPassed,
      totalRules: report.totalRules,
      compliancePercentage: Math.round((report.totalPassed / report.totalRules) * 100),
      timestamp: report.timestamp,
    },
    ruleResults: report.results.map((r) => ({
      ruleId: r.ruleId,
      description: r.description,
      status: r.status,
      details: r.details,
      legalActSection: r.legalActSection,
    })),
    violations: report.results.filter((r) => r.status === 'FAIL').map((r) => ({
      ruleId: r.ruleId,
      description: r.description,
      finding: r.details,
    })),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CompliScan_Report_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV Export ────────────────────────────────────────────────────────────────

export function exportReportAsCSV(report: ComplianceReport): void {
  const headers = ['Rule ID', 'Description', 'Status', 'Details', 'Legal Act Section'];
  const rows = report.results.map((r) => [
    `"${r.ruleId}"`,
    `"${r.description.replace(/"/g, '""')}"`,
    `"${r.status}"`,
    `"${r.details.replace(/"/g, '""')}"`,
    `"${r.legalActSection.replace(/"/g, '""')}"`,
  ]);

  const csvContent = [
    `# CompliScan Compliance Report — ${new Date().toLocaleString('en-IN')}`,
    `# Score: ${report.score} | Timestamp: ${report.timestamp}`,
    '',
    headers.join(','),
    ...rows.map((r) => r.join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `CompliScan_Report_${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
