import { createHash } from 'node:crypto';
import type { JWTPayload } from './authMiddleware.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeInspection(body: any, user: JWTPayload, photos: { buffer: Buffer; mimetype: string }[]) {
  if (!UUID.test(body.id) || !UUID.test(body.client_event_id)) throw new Error('Valid inspection and event IDs are required');
  const report = JSON.parse(body.report_json);
  if (!Array.isArray(report.results) || !report.results.length || report.results.length > 100 || report.results.some((result: any) => !['PASS', 'FAIL', 'WARNING'].includes(result.status))) throw new Error('Valid audit results are required');
  const timestamp = body.timestamp;
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Valid capture timestamp is required');
  const manifest = report.evidence?.images || [];
  if (!Array.isArray(manifest) || manifest.length !== photos.length || photos.length > 5) throw new Error('Every declared original photograph must be uploaded');
  const verifiedPhotos = photos.map((photo, index) => {
    const sha256 = createHash('sha256').update(photo.buffer).digest('hex');
    if (sha256 !== manifest[index]?.sha256 || !/^image\/(jpeg|jpg|png|webp|gif|bmp|tiff|heic|heif|avif)$/.test(photo.mimetype)) throw new Error('Original photograph hash or type mismatch');
    return { sha256, base64: photo.buffer.toString('base64'), mimeType: photo.mimetype };
  });
  if (manifest.length) {
    const checksum = manifest.length === 1 ? verifiedPhotos[0].sha256 : createHash('sha256').update(JSON.stringify(manifest.map((photo: any) => ({ imageIndex: photo.imageIndex, fileName: photo.fileName, surface: photo.surface, sha256: photo.sha256 })))).digest('hex');
    if (checksum !== report.evidence.checksum) throw new Error('Evidence manifest checksum mismatch');
  }
  const passed = report.results.filter((result: any) => result.status === 'PASS').length;
  report.totalPassed = passed; report.totalRules = report.results.length; report.score = `${passed}/${report.totalRules}`;
  report.inspection = { ...report.inspection, id: body.id, capturedAt: timestamp, inspectorId: user.inspectorId, inspectorName: user.name };
  const location = report.inspection?.location;
  if (location?.status === 'recorded' && (!Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180)) throw new Error('Invalid location coordinates');
  return { payload: { id: body.id, timestamp, product_name: String(body.product_name || 'Unknown Product').slice(0, 500), barcode: String(body.barcode || '').slice(0, 30),
    passed, total: report.totalRules, score: report.score, report_json: JSON.stringify(report), tokens_json: body.tokens_json || '{}', raw_text: String(body.raw_text || '').slice(0, 100000),
    image_thumbnail: String(body.image_thumbnail || '').slice(0, 250000), inspector_id: user.inspectorId, inspector_name: user.name,
    location: location?.status === 'recorded' ? `${location.latitude}, ${location.longitude}` : '', revision_reason: String(body.revision_reason || '').slice(0, 2000),
    identity_mismatch: body.inspector_id !== user.inspectorId || body.inspector_name !== user.name }, photos: verifiedPhotos };
}

export function supervisionFlags(payload: any, previous?: any, receivedAt = new Date().toISOString()): string[] {
  const report = JSON.parse(payload.report_json); const flags: string[] = [];
  const location = report.inspection?.location;
  if (location?.status !== 'recorded') flags.push('LOCATION_MISSING');
  if ((location?.accuracyM || 0) > 100) flags.push('LOCATION_LOW_ACCURACY');
  if (!report.evidence?.images?.length) flags.push('ORIGINAL_PHOTOS_MISSING');
  if (report.inspection?.sources?.includes('manual')) flags.push('MANUAL_DECLARATIONS');
  if (payload.identity_mismatch) flags.push('IDENTITY_MISMATCH');
  const delay = Date.parse(receivedAt) - Date.parse(payload.timestamp);
  if (delay > 24 * 3600000) flags.push('DELAYED_SYNC');
  if (delay < -5 * 60000) flags.push('CAPTURE_TIME_IN_FUTURE');
  if (previous) {
    flags.push('REVISED_INSPECTION');
    if (!payload.revision_reason.trim()) flags.push('CORRECTION_REASON_MISSING');
    const old = JSON.parse(previous.report_json);
    if (old.results.some((result: any) => result.status === 'FAIL' && report.results.some((next: any) => next.ruleId === result.ruleId && next.status === 'PASS'))) flags.push('FAILED_CHECK_CHANGED_TO_PASS');
    if ((old.evidence?.images || []).some((image: any) => !(report.evidence?.images || []).some((next: any) => next.sha256 === image.sha256))) flags.push('PHOTOGRAPHS_REMOVED');
  }
  return flags;
}
