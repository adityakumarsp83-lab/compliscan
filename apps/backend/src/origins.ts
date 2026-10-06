/** Only explicitly configured frontend origins may call the hosted API. */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(192\.168\.\d+\.\d+|192\.0\.0\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) return true;
  const allowed = (process.env.FRONTEND_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  return allowed.includes(origin);
}
