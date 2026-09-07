/**
 * Canvas-based image pre-processing pipeline for CompliScan.
 * Enhances packaging photos before sending to Tesseract.js.
 *
 * Pipeline:
 *  1. Grayscale conversion (luminance formula)
 *  2. Adaptive contrast stretch (per-tile histogram equalization)
 *  3. 3×3 unsharp mask sharpening kernel
 *  4. Deskew heuristic (correct rotation if > 5°)
 *
 * No OpenCV.js required — all operations use OffscreenCanvas / Canvas 2D API.
 */

const TILE_SIZE = 64; // tiles for CLAHE-style contrast
const SHARPEN_STRENGTH = 0.6; // unsharp mask alpha

/** Convert an ImageData to grayscale in-place */
function toGrayscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = lum;
  }
}

/** Apply per-tile histogram equalization (CLAHE-lite) */
function adaptiveContrastStretch(data: Uint8ClampedArray, width: number, height: number): void {
  const xTiles = Math.ceil(width / TILE_SIZE);
  const yTiles = Math.ceil(height / TILE_SIZE);

  for (let ty = 0; ty < yTiles; ty++) {
    for (let tx = 0; tx < xTiles; tx++) {
      const x0 = tx * TILE_SIZE;
      const y0 = ty * TILE_SIZE;
      const x1 = Math.min(x0 + TILE_SIZE, width);
      const y1 = Math.min(y0 + TILE_SIZE, height);

      // Build histogram for this tile
      const hist = new Uint32Array(256);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          hist[data[(y * width + x) * 4]]++;
        }
      }

      // Find min/max non-zero bins (clip 1% tails)
      const pixelCount = (x1 - x0) * (y1 - y0);
      const clip = pixelCount * 0.01;
      let lo = 0;
      let hi = 255;
      let cumLo = 0;
      let cumHi = 0;
      for (let v = 0; v < 256; v++) {
        cumLo += hist[v];
        if (cumLo < clip) lo = v;
      }
      for (let v = 255; v >= 0; v--) {
        cumHi += hist[v];
        if (cumHi < clip) hi = v;
      }

      if (hi <= lo) continue;
      const range = hi - lo;

      // Remap pixels in this tile
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * width + x) * 4;
          const stretched = Math.round(((data[idx] - lo) / range) * 255);
          const clamped = Math.max(0, Math.min(255, stretched));
          data[idx] = data[idx + 1] = data[idx + 2] = clamped;
        }
      }
    }
  }
}

/** 3×3 unsharp mask sharpening — enhances text edges */
function sharpen(data: Uint8ClampedArray, width: number, height: number): void {
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]; // standard sharpening kernel
  const copy = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const kIdx = (ky + 1) * 3 + (kx + 1);
          const pIdx = ((y + ky) * width + (x + kx)) * 4;
          sum += copy[pIdx] * kernel[kIdx];
        }
      }
      const clamped = Math.max(0, Math.min(255, Math.round(sum)));
      const idx = (y * width + x) * 4;
      // Blend: alpha * sharpened + (1-alpha) * original
      const blended = Math.round(SHARPEN_STRENGTH * clamped + (1 - SHARPEN_STRENGTH) * copy[idx]);
      data[idx] = data[idx + 1] = data[idx + 2] = Math.max(0, Math.min(255, blended));
    }
  }
}

/**
 * Detect dominant text angle using horizontal projection profiles.
 * Returns estimated skew angle in degrees (-45 to +45).
 */
function estimateSkewAngle(data: Uint8ClampedArray, width: number, height: number): number {
  const THRESHOLD = 128;
  let bestAngle = 0;
  let bestScore = -Infinity;

  // Test angles from -15° to +15° in 1° steps
  for (let angleDeg = -15; angleDeg <= 15; angleDeg += 1) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const projection = new Int32Array(height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const px = data[(y * width + x) * 4];
        if (px < THRESHOLD) {
          // Dark pixel (text) — project onto rotated horizontal axis
          const projY = Math.round(y * Math.cos(angleRad) - x * Math.sin(angleRad)) + height / 2;
          if (projY >= 0 && projY < height) {
            projection[projY]++;
          }
        }
      }
    }

    // Score = variance of projection (high variance = aligned text rows)
    const mean = projection.reduce((a, b) => a + b, 0) / height;
    const variance = projection.reduce((a, b) => a + (b - mean) ** 2, 0) / height;
    if (variance > bestScore) {
      bestScore = variance;
      bestAngle = angleDeg;
    }
  }

  return bestAngle;
}

/**
 * Main export: enhances an image File/Blob and returns a processed Blob.
 * Drop-in replacement for the raw file before Tesseract.recognize().
 */
export async function enhanceImage(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;

      // Step 1: Grayscale
      toGrayscale(data);

      // Step 2: Adaptive contrast
      adaptiveContrastStretch(data, width, height);

      // Step 3: Sharpen
      sharpen(data, width, height);

      ctx.putImageData(imageData, 0, 0);

      // Step 4: Deskew (only if significant skew detected)
      const skewAngle = estimateSkewAngle(data, width, height);
      if (Math.abs(skewAngle) > 2) {
        const rotCanvas = document.createElement('canvas');
        rotCanvas.width = width;
        rotCanvas.height = height;
        const rotCtx = rotCanvas.getContext('2d')!;
        rotCtx.fillStyle = '#ffffff';
        rotCtx.fillRect(0, 0, width, height);
        rotCtx.translate(width / 2, height / 2);
        rotCtx.rotate((-skewAngle * Math.PI) / 180);
        rotCtx.drawImage(canvas, -width / 2, -height / 2);
        rotCanvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas toBlob failed after deskew'));
          },
          'image/png'
        );
        return;
      }

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob failed'));
        },
        'image/png'
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image load failed during pre-processing'));
    };

    img.src = url;
  });
}

/** Generate a small thumbnail base64 string (for history storage) */
export function generateThumbnail(file: File | Blob, maxSide = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(maxSide / img.naturalWidth, maxSide / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Thumbnail generation failed'));
    };

    img.src = url;
  });
}
