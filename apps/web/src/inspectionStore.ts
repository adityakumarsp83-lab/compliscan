import { get, delMany, createStore, promisifyRequest, keys, del, set } from 'idb-keyval';
import { isLegacyDemoInspection } from './inspectionMetadata';
import { v4 } from './uuid-shim';
import type { TaggedScan } from './tokenMerger';

export interface StoredInspection {
  id: string;
  owner_username?: string;
  timestamp: string;
  product_name: string;
  barcode: string;
  score: string;
  passed: number;
  total: number;
  raw_text: string;
  tokens_json: string;
  report_json: string;
  image_thumbnail: string;
  inspector_id: string;
  inspector_name: string;
  location: string;
}

export interface StoredPhoto {
  blob: Blob;
  fileName: string;
  lastModified: number;
  surface: string;
  sha256: string;
  thumbnail: string;
  scans: TaggedScan[];
  barcodeScan?: import('./barcodeTypes').BarcodeScan;
}

export interface StoredEvidence {
  photos: StoredPhoto[];
  referenceWidthMm?: number;
  referenceImageSha?: string;
  barcodeWidthPx: number;
  scaleRatio: number;
}

export async function getInspectionEvidence(id: string): Promise<StoredEvidence | null> {
  return (await get<StoredEvidence>(`evidence:${id}`)) ?? null;
}

const INDEX_KEY = '__compliscan_index__';
const inspectionStore = createStore('keyval-store', 'keyval');

/** Get the ordered list of inspection IDs (newest first) */
async function getIndex(): Promise<string[]> {
  return (await get<string[]>(INDEX_KEY)) || [];
}

/** Save a completed inspection to IndexedDB */
export async function saveInspection(record: StoredInspection, evidence?: StoredEvidence, owner?: string, revisionReason = ''): Promise<void> {
  await inspectionStore('readwrite', (store) => {
    const completion = promisifyRequest(store.transaction);
    const request = store.get(INDEX_KEY);
    request.onsuccess = () => {
      try {
        const index: string[] = request.result || [];
        if (owner) {
          const eventId = v4();
          store.put({ eventId, owner, createdAt: Date.now(), record, evidence, revisionReason }, `outbox:${eventId}`);
        }
        store.put(record, `inspection:${record.id}`);
        if (evidence) store.put(evidence, `evidence:${record.id}`);
        store.put([record.id, ...index.filter((id) => id !== record.id)], INDEX_KEY);
      } catch { store.transaction.abort(); }
    };
    return completion;
  });
}

export interface ListOptions {
  search?: string;
  barcode?: string;
  limit?: number;
  offset?: number;
}

/** List inspections with optional search/filter */
export async function listInspections(opts: ListOptions = {}): Promise<StoredInspection[]> {
  const index = await getIndex();
  const all: StoredInspection[] = [];

  for (const id of index) {
    const record = await get<StoredInspection>(`inspection:${id}`);
    if (record && !isLegacyDemoInspection(record)) all.push(record);
  }

  let filtered = all;

  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.product_name.toLowerCase().includes(q) ||
        r.barcode.includes(q) ||
        r.inspector_id.toLowerCase().includes(q)
    );
  }

  if (opts.barcode) {
    filtered = filtered.filter((r) => r.barcode === opts.barcode);
  }

  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return filtered.slice(offset, offset + limit);
}

/** Get a single inspection by ID */
export async function getInspection(id: string): Promise<StoredInspection | null> {
  return (await get<StoredInspection>(`inspection:${id}`)) ?? null;
}

/** Delete an inspection by ID */
export async function deleteInspection(id: string): Promise<void> {
  await inspectionStore('readwrite', (store) => {
    const completion = promisifyRequest(store.transaction);
    const request = store.get(INDEX_KEY);
    request.onsuccess = () => {
      const index: string[] = request.result || [];
      store.delete(`inspection:${id}`);
      store.delete(`evidence:${id}`);
      store.put(index.filter((item) => item !== id), INDEX_KEY);
    };
    return completion;
  });
}

/** Get total count of inspections */
export async function countInspections(): Promise<number> {
  const index = await getIndex();
  return index.length;
}

/** Clear all inspections */
export async function clearAllInspections(): Promise<void> {
  const allKeys = await keys();
  await delMany(allKeys.filter((key) => typeof key === 'string' &&
    (key.startsWith('inspection:') || key.startsWith('evidence:') || key === INDEX_KEY)));
}

export interface PendingInspection {
  eventId: string; owner: string; createdAt: number;
  record: StoredInspection; evidence?: StoredEvidence; revisionReason: string;
}
export async function pendingInspections(owner?: string): Promise<PendingInspection[]> {
  const allKeys = await keys();
  const pending = await Promise.all(allKeys.filter(key => typeof key === 'string' && key.startsWith('outbox:')).map(key => get<PendingInspection>(key)));
  return pending.filter((item): item is PendingInspection => !!item && (!owner || item.owner === owner)).sort((a,b) => a.createdAt-b.createdAt);
}
export async function acknowledgeInspection(event: PendingInspection, receipt: object): Promise<void> {
  await set(`sync:${event.record.id}`, receipt);
  await del(`outbox:${event.eventId}`);
}

const migrationJobs = new Map<string, Promise<void>>();
/** Queue genuine earlier local records once, retaining their original capture metadata. */
export function queueEarlierInspections(owner: string, inspectorId: string): Promise<void> {
  const existing = migrationJobs.get(owner); if (existing) return existing;
  const job = (async () => {
    const queuedIds = new Set((await pendingInspections(owner)).map(item=>item.record.id));
    for (const record of await listInspections({ limit:Number.MAX_SAFE_INTEGER })) {
      if ((record.owner_username ? record.owner_username !== owner : record.inspector_id !== inspectorId) || queuedIds.has(record.id) || await get(`sync:${record.id}`)) continue;
      const evidence = await getInspectionEvidence(record.id);
      await saveInspection({ ...record, owner_username:owner }, evidence || undefined, owner, 'Earlier local inspection submitted to central archive');
      queuedIds.add(record.id);
    }
  })();
  migrationJobs.set(owner,job); return job;
}
