/**
 * PaddleOCR Client for CompliScan
 * Connects to a PaddleOCR Python service or executes the local PaddleOCR runner.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PaddleOcrItem {
  text: string;
  confidence: number;
  box: number[][]; // [[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
}

export interface PaddleOcrResponse {
  rawText: string;
  items: PaddleOcrItem[];
}

/**
 * Execute PaddleOCR on an image buffer.
 * First checks PADDLE_OCR_SERVICE_URL (FastAPI / Flask microservice).
 * If not running as a microservice, tries the CLI Python script if python + paddleocr are installed.
 */
export async function runPaddleOcr(imageBuffer: Buffer): Promise<PaddleOcrResponse> {
  const serviceUrl = process.env.PADDLE_OCR_SERVICE_URL || 'http://127.0.0.1:8000/ocr';

  // 1. Attempt HTTP microservice first (with quick retry if service is still starting up)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout for OCR

      const formData = new FormData();
      const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
      formData.append('file', blob, 'image.jpg');

      const res = await fetch(serviceUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data: any = await res.json();
        const items: PaddleOcrItem[] = data.results || data.items || [];
        const rawText = items.map((i) => i.text).join('\n');
        return { rawText, items };
      }
    } catch {
      // If service is just starting up, wait briefly and retry
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // 2. Fallback to local python script execution
  return runLocalPaddleOcrScript(imageBuffer);
}

/**
 * Local Python CLI runner for PaddleOCR
 */
async function runLocalPaddleOcrScript(imageBuffer: Buffer): Promise<PaddleOcrResponse> {
  const tempFile = path.join(os.tmpdir(), `compliscan_paddle_${Date.now()}.jpg`);
  fs.writeFileSync(tempFile, imageBuffer);

  const candidateRoots = [
    path.resolve(process.cwd(), '..'),
    process.cwd(),
    '/Users/adityakumar/compliscan',
  ];
  let repoRoot = '/Users/adityakumar/compliscan';
  let pythonBin = process.env.PYTHON_BIN || '';

  for (const root of candidateRoots) {
    const candidatePy = path.join(root, '.venv_paddle/bin/python');
    if (fs.existsSync(candidatePy)) {
      repoRoot = root;
      pythonBin = candidatePy;
      break;
    }
  }

  if (!pythonBin) {
    pythonBin = '/Users/adityakumar/compliscan/.venv_paddle/bin/python';
  }
  const scriptPath = path.join(repoRoot, 'services/paddle_ocr.py');

  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [scriptPath, tempFile]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      try {
        fs.unlinkSync(tempFile);
      } catch {}

      if (code !== 0) {
        reject(
          new Error(
            `PaddleOCR script exited with code ${code}. Error: ${stderr || stdout || 'Ensure paddleocr is installed'}`
          )
        );
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const items: PaddleOcrItem[] = (parsed.lines || []).map((l: any) => ({
          text: l.text || '',
          confidence: l.confidence || 0,
          box: l.box || [],
        }));
        const rawText = items.map((i) => i.text).join('\n');
        resolve({ rawText, items });
      } catch (err: any) {
        reject(new Error(`Failed to parse PaddleOCR output: ${err.message}`));
      }
    });

    proc.on('error', (err) => {
      try {
        fs.unlinkSync(tempFile);
      } catch {}
      reject(new Error(`Could not spawn python process (${pythonBin}): ${err.message}`));
    });
  });
}
