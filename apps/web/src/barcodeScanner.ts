import type { BarcodeScan, DecodedBarcode } from './barcodeTypes';

/** Bundled module worker works without BarcodeDetector, a server, or a CDN. */
async function scanBarcodeOnce(file: Blob): Promise<BarcodeScan> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = url;
    });
    const ratio = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight), Math.sqrt(1800000 / (image.naturalWidth * image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { status: 'unavailable' };
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return await new Promise<BarcodeScan>((resolve) => {
      const worker = new Worker(new URL('./barcodeWorker.ts', import.meta.url), { type: 'module' });
      const timer = setTimeout(() => finish({ status: 'unavailable' }), 12000);
      const finish = (result: BarcodeScan) => { clearTimeout(timer); worker.terminate(); resolve(result); };
      worker.onerror = () => finish({ status: 'unavailable' });
      worker.onmessage = (event: MessageEvent<{ barcode?: DecodedBarcode; unavailable?: boolean }>) => {
        const barcode = event.data.barcode;
        if (!barcode) { finish({ status: event.data.unavailable ? 'unavailable' : 'not-found' }); return; }
        const scaleX = image.naturalWidth / canvas.width;
        const scaleY = image.naturalHeight / canvas.height;
        const points = barcode.points.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
        // The decoded line may be vertical. Transform its width using the measured line direction.
        const before = Math.hypot(barcode.points[1].x - barcode.points[0].x, barcode.points[1].y - barcode.points[0].y);
        const after = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        finish({ status: 'detected', barcode: { ...barcode, points, widthPx: Math.round(barcode.widthPx * (before ? after / before : 0) * 100) / 100 } });
      };
      worker.postMessage({ rgba, width: canvas.width, height: canvas.height }, [rgba.buffer]);
    });
  } catch { return { status: 'unavailable' }; }
  finally { URL.revokeObjectURL(url); }
}

export async function scanBarcode(file: Blob): Promise<BarcodeScan> {
  const result = await scanBarcodeOnce(file);
  // Vite may rebuild a newly installed dependency as the first worker starts.
  if (result.status === 'unavailable' && import.meta.env.DEV) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return scanBarcodeOnce(file);
  }
  return result;
}
