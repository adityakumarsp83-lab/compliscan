/**
 * PaddleOCR Background Service Manager
 * Automatically starts the FastAPI PaddleOCR microservice when the backend starts,
 * and ensures clean termination on shutdown.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

let paddleProcess: ChildProcess | null = null;

const PADDLE_PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${PADDLE_PORT}/health`;

/**
 * Check if PaddleOCR microservice is already healthy.
 */
export async function isPaddleServiceRunning(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      const data: any = await res.json().catch(() => ({}));
      return data.status === 'ok';
    }
  } catch {}
  return false;
}

/**
 * Start the PaddleOCR microservice automatically if not already running.
 */
export async function startPaddleServiceIfNeeded(): Promise<void> {
  const alreadyRunning = await isPaddleServiceRunning();
  if (alreadyRunning) {
    console.log(`   PaddleOCR Service: ✅ Running on port ${PADDLE_PORT}`);
    return;
  }

  // Find Python/Uvicorn in .venv_paddle or system
  const candidateRoots = [
    path.resolve(process.cwd(), '..'),
    process.cwd(),
    '/Users/adityakumar/compliscan',
  ];
  let repoRoot = '/Users/adityakumar/compliscan';
  let venvUvicorn = '';

  for (const root of candidateRoots) {
    const candidate = path.join(root, '.venv_paddle/bin/uvicorn');
    if (fs.existsSync(candidate)) {
      repoRoot = root;
      venvUvicorn = candidate;
      break;
    }
  }

  const command = venvUvicorn || '/Users/adityakumar/compliscan/.venv_paddle/bin/uvicorn';
  const args = ['services.paddle_service:app', '--host', '127.0.0.1', '--port', String(PADDLE_PORT), '--log-level', 'info'];

  console.log(`   PaddleOCR Service: 🚀 Starting auto-managed service on port ${PADDLE_PORT}...`);

  try {
    paddleProcess = spawn(command, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONPATH: repoRoot,
      },
    });

    paddleProcess.stdout?.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg) console.log(`[PaddleOCR] ${msg}`);
    });

    paddleProcess.stderr?.on('data', (d) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('INFO:')) {
        console.warn(`[PaddleOCR] ${msg}`);
      }
    });

    paddleProcess.on('error', (err) => {
      console.warn(`[PaddleOCR] Auto-start failed: ${err.message}`);
      paddleProcess = null;
    });

    paddleProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[PaddleOCR] Process exited with code ${code}`);
      }
      paddleProcess = null;
    });

    // Clean up process on backend shutdown
    const cleanup = () => {
      if (paddleProcess) {
        try {
          paddleProcess.kill('SIGTERM');
        } catch {}
        paddleProcess = null;
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

  } catch (err: any) {
    console.warn(`[PaddleOCR] Could not start microservice: ${err.message}`);
  }
}
