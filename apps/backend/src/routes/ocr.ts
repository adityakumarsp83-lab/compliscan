import { Router } from 'express';
import multer from 'multer';
import { analyzeImageWithGemini, analyzeOcrTextWithGemini } from '../geminiClient.js';
import { annotateWithGoogleVision } from '../googleVisionClient.js';
import { runPaddleOcr } from '../paddleClient.js';
import { authMiddleware } from '../authMiddleware.js';

const router = Router();

// Use memory storage — image lives in buffer, not disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max per image
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are accepted'));
    }
  },
});

/**
 * POST /api/ocr/vision
 * Auth: Bearer JWT required
 * Runs Google Cloud Vision OCR -> Gemini LLM field extraction
 */
router.post('/vision', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image file provided. Use field name "image".' });
    return;
  }

  try {
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';

    // Step 1: High accuracy text detection via Google Cloud Vision
    const visionRes = await annotateWithGoogleVision(base64Image);

    // Step 2: Extract Legal Metrology compliance fields using Gemini LLM
    const complianceData = await analyzeOcrTextWithGemini(visionRes.rawText, base64Image, mimeType);

    res.json({
      success: true,
      engine: 'google_vision+gemini',
      rawText: visionRes.rawText,
      annotations: visionRes.annotations,
      data: complianceData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Google Cloud Vision OCR failed';
    console.error('[/api/ocr/vision] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/ocr/paddle
 * Auth: Bearer JWT required
 * Runs PaddleOCR -> Gemini LLM field extraction
 */
router.post('/paddle', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image file provided. Use field name "image".' });
    return;
  }

  try {
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';

    // Step 1: Run PaddleOCR
    const paddleRes = await runPaddleOcr(req.file.buffer);

    // Step 2: Extract Legal Metrology compliance fields using Gemini LLM
    const complianceData = await analyzeOcrTextWithGemini(paddleRes.rawText, base64Image, mimeType);

    res.json({
      success: true,
      engine: 'paddleocr+gemini',
      rawText: paddleRes.rawText,
      items: paddleRes.items,
      data: complianceData,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'PaddleOCR failed';
    console.error('[/api/ocr/paddle] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/ocr/gemini
 * Direct Gemini Multimodal Vision extraction
 */
router.post('/gemini', authMiddleware, upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image file provided. Use field name "image".' });
    return;
  }

  try {
    const base64Image = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';

    const result = await analyzeImageWithGemini(base64Image, mimeType);
    res.json({ success: true, engine: 'gemini_vision', data: result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Gemini API call failed';
    console.error('[/api/ocr/gemini] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/ocr/gemini-batch
 */
router.post('/gemini-batch', authMiddleware, upload.array('images', 5), async (req, res) => {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No image files provided. Use field name "images".' });
    return;
  }

  try {
    const results = await Promise.all(
      files.map(async (file, idx) => {
        const base64Image = file.buffer.toString('base64');
        const mimeType = file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';
        try {
          const data = await analyzeImageWithGemini(base64Image, mimeType);
          return { imageIndex: idx, success: true, data };
        } catch (err) {
          return {
            imageIndex: idx,
            success: false,
            error: err instanceof Error ? err.message : 'Failed',
            data: null,
          };
        }
      })
    );
    res.json({ success: true, results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Batch Gemini call failed';
    console.error('[/api/ocr/gemini-batch] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
