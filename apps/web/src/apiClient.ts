/**
 * Typed API client for CompliScan backend.
 * Automatically attaches JWT from sessionStorage on every request.
 */

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

// ── Types mirroring backend responses ──────────────────────────────────────

export interface GeminiExtractionResult {
  manufacturer_name: string | null;
  manufacturer_address: string | null;
  pin_code: string | null;
  generic_name: string | null;
  net_quantity_value: number | null;
  net_quantity_unit: string | null;
  mrp_value: number | null;
  mrp_text_exact: string | null;
  mrp_includes_all_taxes: boolean;
  mfg_date: string | null;
  exp_date: string | null;
  country_of_origin: string | null;
  consumer_care_phone: string | null;
  consumer_care_email: string | null;
  consumer_care_name: string | null;
  fssai_license: string | null;
  language_used: string[];
  sticker_over_mrp_detected: boolean;
  prohibited_qualifiers_found: string[];
  non_si_units_found: string[];
  usp_value: number | null;
  usp_unit: string | null;
  raw_extracted_text: string;
}

export interface AuthUser {
  userId: string;
  name: string;
  role: 'INSPECTOR' | 'ADMIN';
  inspectorId: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// ── Token helpers ───────────────────────────────────────────────────────────

export function getToken(): string | null {
  return sessionStorage.getItem('compliscan_jwt');
}

export function setToken(token: string): void {
  sessionStorage.setItem('compliscan_jwt', token);
}

export function clearToken(): void {
  sessionStorage.removeItem('compliscan_jwt');
  sessionStorage.removeItem('compliscan_user');
  localStorage.removeItem('compliscan_offline_user');
}

export function getStoredUser(): AuthUser | null {
  const raw = sessionStorage.getItem('compliscan_user') || localStorage.getItem('compliscan_offline_user');
  if (!raw) return null;
  try { return JSON.parse(raw) as AuthUser; } catch { return null; }
}

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── API calls ───────────────────────────────────────────────────────────────

/** POST /api/auth/login */
export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Login failed' }));
    throw new Error(err.error || 'Login failed');
  }
  const data = (await res.json()) as LoginResponse;
  setToken(data.token);
  sessionStorage.setItem('compliscan_user', JSON.stringify(data.user));
  // Remember only the local inspector profile, never a persistent bearer token.
  localStorage.setItem('compliscan_offline_user', JSON.stringify(data.user));
  return data;
}

/** POST /api/auth/signup */
export async function signup(username: string, password: string, fullName: string, inspectorId: string): Promise<LoginResponse> {
  const res = await fetch(`${BACKEND_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, fullName, inspectorId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Signup failed' }));
    throw new Error(err.error || 'Signup failed');
  }
  const data = (await res.json()) as LoginResponse;
  setToken(data.token);
  sessionStorage.setItem('compliscan_user', JSON.stringify(data.user));
  // Remember only the local inspector profile, never a persistent bearer token.
  localStorage.setItem('compliscan_offline_user', JSON.stringify(data.user));
  return data;
}

/** POST /api/auth/verify — validates token on app load */
export async function verifyStoredToken(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token || !navigator.onLine) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) { clearToken(); return null; }
    const data = await res.json();
    return data.valid ? data.user as AuthUser : null;
  } catch {
    return null; // backend offline — allow offline use
  }
}

/** POST /api/ocr/gemini — send single image for Gemini OCR */
export async function geminiOcr(imageFile: File | Blob): Promise<GeminiExtractionResult> {
  const formData = new FormData();
  formData.append('image', imageFile, 'label.jpg');

  const res = await fetch(`${BACKEND_URL}/api/ocr/gemini`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Gemini OCR failed' }));
    throw new Error(err.error || 'Gemini OCR failed');
  }

  const data = await res.json();
  return data.data as GeminiExtractionResult;
}

/** POST /api/ocr/gemini-batch — send up to 5 images */
export async function geminiBatchOcr(
  imageFiles: (File | Blob)[]
): Promise<Array<{ imageIndex: number; success: boolean; data: GeminiExtractionResult | null; error?: string }>> {
  const formData = new FormData();
  imageFiles.forEach((file, idx) => {
    formData.append('images', file, `label_${idx}.jpg`);
  });

  const res = await fetch(`${BACKEND_URL}/api/ocr/gemini-batch`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Gemini batch OCR failed' }));
    throw new Error(err.error || 'Gemini batch OCR failed');
  }

  const data = await res.json();
  return data.results;
}

/** POST /api/ocr/vision — send image for Google Cloud Vision OCR + Gemini LLM parsing */
export async function googleVisionOcr(imageFile: File | Blob): Promise<{ data: GeminiExtractionResult; rawText: string; annotations: any[] }> {
  const formData = new FormData();
  formData.append('image', imageFile, 'label.jpg');

  const res = await fetch(`${BACKEND_URL}/api/ocr/vision`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Google Vision OCR failed' }));
    throw new Error(err.error || 'Google Vision OCR failed');
  }

  const data = await res.json();
  return { data: data.data as GeminiExtractionResult, rawText: data.rawText, annotations: data.annotations };
}

/** POST /api/ocr/paddle — send image for PaddleOCR + Gemini LLM parsing */
export async function paddleOcr(imageFile: File | Blob): Promise<{ data: GeminiExtractionResult; rawText: string; items: any[] }> {
  const formData = new FormData();
  formData.append('image', imageFile, 'label.jpg');

  const res = await fetch(`${BACKEND_URL}/api/ocr/paddle`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'PaddleOCR failed' }));
    throw new Error(err.error || 'PaddleOCR failed');
  }

  const data = await res.json();
  return { data: data.data as GeminiExtractionResult, rawText: data.rawText, items: data.items };
}

/** POST /api/history — save a completed scan */
export async function saveToBackendHistory(record: object): Promise<string | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(record),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id as string;
  } catch {
    return null; // silent fail — local IndexedDB save is primary
  }
}

/** GET /api/history — list past scans */
export async function fetchBackendHistory(params?: {
  search?: string;
  barcode?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: object[]; pagination: object } | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.barcode) qs.set('barcode', params.barcode);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));

    const res = await fetch(`${BACKEND_URL}/api/history?${qs}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Check if backend is reachable */
export async function isBackendOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
