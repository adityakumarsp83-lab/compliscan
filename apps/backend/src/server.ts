import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRouter from './routes/auth.js';
import ocrRouter from './routes/ocr.js';
import historyRouter from './routes/history.js';
import { startPaddleServiceIfNeeded, isPaddleServiceRunning } from './paddleServiceManager.js';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'],
    credentials: true,
  })
);

// JSON body parsing (for auth routes etc)
app.use(express.json({ limit: '50mb' })); // large for base64 image payloads
app.use(express.urlencoded({ extended: true }));

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const paddleActive = await isPaddleServiceRunning();
  res.json({
    status: 'ok',
    service: 'CompliScan Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    gemini_configured: !!process.env.GEMINI_API_KEY,
    google_vision_configured: !!process.env.GOOGLE_VISION_API_KEY && process.env.GOOGLE_VISION_API_KEY !== 'your_google_vision_api_key_here',
    paddle_running: paddleActive,
    db_connected: !!process.env.DATABASE_URL
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/history', historyRouter);

// ── 404 fallback ────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🛡️  CompliScan Backend running on http://localhost:${PORT}`);
  console.log(`   Gemini LLM: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '⚠️  GEMINI_API_KEY not set'}`);
  console.log(`   Google Vision API: ${process.env.GOOGLE_VISION_API_KEY ? '✅ Configured' : '⚪ Not set (GOOGLE_VISION_API_KEY)'}`);
  console.log(`   Auth: JWT enabled`);
  console.log(`   DB: ${process.env.DATABASE_URL ? '✅ Connected (Neon PostgreSQL)' : '⚠️  DATABASE_URL not set'}`);

  // Automatically start PaddleOCR microservice
  await startPaddleServiceIfNeeded();
});

export default app;
