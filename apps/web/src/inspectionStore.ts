import { get, delMany, createStore, promisifyRequest, keys } from 'idb-keyval';
import { isLegacyDemoInspection } from './inspectionMetadata';
import type { TaggedScan } from './tokenMerger';

export interface StoredInspection {
  id: string;
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
}

export interface StoredEvidence {
  photos: StoredPhoto[];
  referenceWidthMm?: number;
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
export async function saveInspection(record: StoredInspection, evidence?: StoredEvidence): Promise<void> {
  await inspectionStore('readwrite', (store) => {
    const completion = promisifyRequest(store.transaction);
    const request = store.get(INDEX_KEY);
    request.onsuccess = () => {
      try {
        const index: string[] = request.result || [];
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
