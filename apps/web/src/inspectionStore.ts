import { get, set, del, keys } from 'idb-keyval';

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

const INDEX_KEY = '__compliscan_index__';

/** Get the ordered list of inspection IDs (newest first) */
async function getIndex(): Promise<string[]> {
  return (await get<string[]>(INDEX_KEY)) || [];
}

/** Save a completed inspection to IndexedDB */
export async function saveInspection(record: StoredInspection): Promise<void> {
  await set(`inspection:${record.id}`, record);
  const index = await getIndex();
  // Insert at front (newest first), deduplicate
  const updated = [record.id, ...index.filter((id) => id !== record.id)];
  await set(INDEX_KEY, updated);
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
    if (record) all.push(record);
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
  await del(`inspection:${id}`);
  const index = await getIndex();
  await set(INDEX_KEY, index.filter((i) => i !== id));
}

/** Get total count of inspections */
export async function countInspections(): Promise<number> {
  const index = await getIndex();
  return index.length;
}

/** Clear all inspections */
export async function clearAllInspections(): Promise<void> {
  const allKeys = await keys();
  for (const key of allKeys) {
    if (typeof key === 'string' && (key.startsWith('inspection:') || key === INDEX_KEY)) {
      await del(key);
    }
  }
}
