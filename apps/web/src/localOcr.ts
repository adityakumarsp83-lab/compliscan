import Tesseract from 'tesseract.js';

/** Every OCR dependency comes from this deployment; no CDN is needed in the field. */
export function recognizeLocally(image: Blob, logger: (message: { status: string; progress?: number }) => void) {
  const assets = new URL(`${import.meta.env.BASE_URL}ocr/`, location.origin).href;
  return Tesseract.recognize(image, 'eng', {
    workerPath: `${assets}worker.min.js`,
    corePath: assets,
    langPath: assets,
    workerBlobURL: false,
    logger,
  });
}
