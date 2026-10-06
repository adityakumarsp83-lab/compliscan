import { jsPDF } from 'jspdf';
import type { ComplianceReport } from './engine';
import { locationText } from './inspectionMetadata';
import { blobToDataURL } from './imageEvidence';

// Standard PDF fonts do not encode the rupee sign or typographic dashes correctly.
const pdfText = (text: string) => text.replace(/₹/g, 'Rs. ').replace(/[—–]/g, '-');

// ── PDF Report Generation ────────────────────────────────────────────────────

export async function createImprovementNoticePDF(
  report: ComplianceReport,
  images: (Blob | string)[],
  scaleRatio: number,
  _rawText: string
) {
  const imageDataUrls = await Promise.all(images.map(async (image) => {
    if (image instanceof Blob) return blobToDataURL(image);
    if (image.startsWith('data:image/')) return image;
    const response = await fetch(image);
    if (!response.ok) throw new Error('Could not load photograph for PDF');
    return blobToDataURL(await response.blob());
  }));
  // Normalize browser-supported image formats (including WebP) for reliable jsPDF embedding.
  const preparedImages = await Promise.all(imageDataUrls.map(async (url) => {
    if (/^data:image\/(png|jpeg);/i.test(url)) return url;
    return new Promise<string>((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('Could not prepare photograph for PDF')); return; }
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.95));
      };
      image.onerror = () => reject(new Error('Unsupported photograph format for PDF'));
      image.src = url;
    });
  }));
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const noticeId = report.inspection?.id || 'Reference not recorded';
  const inspectionDate = new Date(report.timestamp).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });

  // 1. Header banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('COMPLISCAN', pageWidth / 2, 10, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('PACKAGED PRODUCT INSPECTION', pageWidth / 2, 16, { align: 'center' });
  doc.text('Original photographs and recorded audit findings', pageWidth / 2, 21, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(56, 189, 248);
  doc.text('INSPECTION EVIDENCE REPORT', pageWidth / 2, 27, { align: 'center' });

  // Legal reference sub-header
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'italic');
  doc.text(
    'Automated findings for inspector review; this export is not an issued statutory notice.',
    pageWidth / 2, 37, { align: 'center' }
  );
  doc.setDrawColor(203, 213, 225);
  doc.line(14, 40, pageWidth - 14, 40);

  // 2. Inspection metadata box
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, 43, pageWidth - 28, 46, 2, 2, 'F');
  doc.rect(14, 43, pageWidth - 28, 46, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text('Inspection ID:', 18, 49); doc.setFont('helvetica', 'normal'); doc.text(noticeId, 45, 49);
  doc.setFont('helvetica', 'bold'); doc.text('Timestamp:', 18, 55); doc.setFont('helvetica', 'normal'); doc.text(inspectionDate, 45, 55);
  doc.setFont('helvetica', 'bold'); doc.text('Score:', 18, 61);
  doc.setFont('helvetica', 'bold');
  const scoreRatio = report.results.some((result) => result.status === 'FAIL') ? 0 : report.results.some((result) => result.status === 'WARNING') ? 0.5 : 1;
  doc.setTextColor(scoreRatio >= 0.8 ? 22 : scoreRatio >= 0.5 ? 180 : 225, scoreRatio >= 0.8 ? 101 : scoreRatio >= 0.5 ? 100 : 29, scoreRatio >= 0.8 ? 52 : scoreRatio >= 0.5 ? 20 : 72);
  doc.text(`${report.score} Automated Checks Passed`, 45, 61);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold'); doc.text('Optical Scale:', 110, 49); doc.setFont('helvetica', 'normal'); doc.text(scaleRatio > 0 ? `${scaleRatio.toFixed(2)} px/mm` : 'Not calibrated', 140, 49);
  doc.setFont('helvetica', 'bold'); doc.text('OCR Pipeline:', 110, 55); doc.setFont('helvetica', 'normal'); doc.text((report.inspection?.sources || []).join(', ') || 'Not recorded', 140, 55);

  doc.setFont('helvetica', 'bold'); doc.text('Inspector:', 18, 67);
  doc.setFont('helvetica', 'normal'); doc.text(pdfText([report.inspection?.inspectorName, report.inspection?.inspectorId].filter(Boolean).join(' / ') || 'Not recorded'), 45, 67);
  doc.setFont('helvetica', 'bold'); doc.text('Location:', 18, 73);
  doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(pdfText(locationText(report.inspection?.location)), pageWidth - 65), 45, 73);
  if (report.inspection?.location.recordedAt) doc.text(`Position recorded: ${new Date(report.inspection.location.recordedAt).toISOString()}`, 18, 84);

  // 3. Multi-photo evidence grid
  let currentY = 94;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Photographic Evidence', 14, currentY);
  currentY += 4;

  const validImages = preparedImages;
  if (validImages.length > 0) {
    const cols = Math.min(validImages.length, 3);
    const imgW = (pageWidth - 28 - (cols - 1) * 3) / cols;
    const imgH = imgW * 0.75;
    validImages.slice(0, 6).forEach((url, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = 14 + col * (imgW + 3);
      const y = currentY + row * (imgH + 3);
        const properties = doc.getImageProperties(url);
        const scale = Math.min(imgW / properties.width, imgH / properties.height);
        const renderedW = properties.width * scale;
        const renderedH = properties.height * scale;
        doc.addImage(url, properties.fileType, x + (imgW - renderedW) / 2, y + (imgH - renderedH) / 2, renderedW, renderedH, undefined, 'FAST');
        doc.setDrawColor(148, 163, 184);
        doc.rect(x, y, imgW, imgH);
        doc.setFontSize(6);
        doc.setTextColor(100, 116, 139);
        doc.text(`Photo ${idx + 1}`, x + 1, y + imgH - 1);
    });
    const rows = Math.ceil(Math.min(validImages.length, 6) / cols);
    currentY += rows * (imgH + 3) + 5;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('[No original photographs attached to this report.]', 14, currentY + 4);
    currentY += 10;
  }

  // 4. Statutory findings checklist
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Recorded Audit Findings', 14, currentY);
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
    const descriptionLines = doc.splitTextToSize(pdfText(item.description), 69);
    const findingLines = doc.splitTextToSize(pdfText(item.details), pageWidth - 155);
    const rowHeight = Math.max(6.5, Math.max(descriptionLines.length, findingLines.length) * 3 + 2);
    if (currentY + rowHeight > 275) {
      doc.addPage();
      currentY = 20;
    }
    const isPass = item.status === 'PASS';
    const isWarn = item.status === 'WARNING';
    doc.setFillColor(isPass ? 240 : isWarn ? 254 : 254, isPass ? 253 : isWarn ? 243 : 242, isPass ? 244 : isWarn ? 199 : 242);
    doc.rect(14, currentY, pageWidth - 28, rowHeight, 'F');
    doc.rect(14, currentY, pageWidth - 28, rowHeight, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(30, 41, 59);
    doc.text(item.ruleId.slice(0, 16), 17, currentY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.text(descriptionLines, 45, currentY + 4.3);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(isPass ? 22 : isWarn ? 146 : 225, isPass ? 101 : isWarn ? 64 : 29, isPass ? 52 : isWarn ? 14 : 72);
    doc.text(item.status, 118, currentY + 4.3);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text(findingLines, 138, currentY + 4.3);
    currentY += rowHeight;
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
  doc.text('INSPECTOR REVIEW:', 18, currentY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 53, 15);
  const directive = 'Review extracted declarations against the original photographs and applicable rules. Missing or uncertain evidence requires manual verification. This report does not issue a cure deadline, penalty, official seal, or digital signature.';
  doc.text(doc.splitTextToSize(pdfText(directive), pageWidth - 36), 18, currentY + 12);

  // 6. Footer
  currentY += 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Generated by CompliScan from saved inspection data.', 14, currentY);
  doc.text('Unsigned inspection report', pageWidth - 60, currentY);

  if (report.evidence) {
    doc.addPage();
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Original Image Evidence - SHA-256', 14, 20);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Hashes identify original uploaded bytes, before OCR or image enhancement.', 14, 28);
    doc.text(report.evidence.images.length === 1 ? 'Original image checksum:' : 'Ordered multi-image manifest checksum:', 14, 36);
    doc.setFont('courier', 'normal');
    doc.text(report.evidence.checksum, 14, 42);
    let evidenceY = 55;
    for (const image of report.evidence.images) {
      if (evidenceY > 255) { doc.addPage(); evidenceY = 20; }
      doc.setFont('helvetica', 'bold');
      doc.text(`Photo ${image.imageIndex + 1} - ${image.surface}`, 14, evidenceY);
      doc.setFont('helvetica', 'normal');
      const fileLines = doc.splitTextToSize(image.fileName, pageWidth - 28);
      doc.text(fileLines, 14, evidenceY + 5);
      evidenceY += fileLines.length * 4 + 8;
      doc.setFont('courier', 'normal');
      doc.text(image.sha256, 14, evidenceY);
      evidenceY += 14;
    }
  }
  return { doc, fileName: `CompliScan_Report_${noticeId}.pdf` };
}

export async function generateImprovementNoticePDF(
  report: ComplianceReport, images: (Blob | string)[], scaleRatio: number, rawText: string
) {
  const { doc, fileName } = await createImprovementNoticePDF(report, images, scaleRatio, rawText);
  doc.save(fileName);
}

// ── JSON Export ───────────────────────────────────────────────────────────────

export function exportReportAsJSON(report: ComplianceReport): void {
  const exportData = {
    exportedAt: new Date().toISOString(),
    evidence: report.evidence,
    inspection: report.inspection,
    measurements: report.measurements,
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
