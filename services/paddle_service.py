"""
CompliScan - PaddleOCR FastAPI Microservice
Provides high-throughput HTTP OCR endpoint for CompliScan backend.

Run with:
    uvicorn services.paddle_service:app --host 127.0.0.1 --port 8000
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
import numpy as np
import cv2
import io

import os
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

app = FastAPI(title="CompliScan PaddleOCR Service", version="1.0.0")

# Lazy-loaded OCR model instance
_ocr_engine = None

def get_ocr():
    global _ocr_engine
    if _ocr_engine is None:
        from paddleocr import PaddleOCR
        _ocr_engine = PaddleOCR(lang="en")
    return _ocr_engine

@app.get("/health")
def health():
    return {"status": "ok", "service": "paddleocr"}

@app.post("/ocr")
async def process_ocr(file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if img is None:
        raise HTTPException(status_code=400, detail="Invalid image file")

    ocr = get_ocr()
    results = ocr.ocr(img)

    items = []
    if results and len(results) > 0:
        res0 = results[0]
        # PaddleOCR 3.x (PaddleX OCRResult)
        if hasattr(res0, "get") or isinstance(res0, dict):
            texts = res0.get("rec_texts", [])
            scores = res0.get("rec_scores", [])
            boxes = res0.get("rec_polys", []) or res0.get("rec_boxes", [])
            for idx, text in enumerate(texts):
                score = float(scores[idx]) if idx < len(scores) else 1.0
                box = boxes[idx].tolist() if idx < len(boxes) and hasattr(boxes[idx], "tolist") else []
                items.append({
                    "box": box,
                    "text": str(text),
                    "confidence": round(score, 4)
                })
        # Classic PaddleOCR format: [[box, [text, confidence]], ...]
        elif isinstance(res0, list):
            for line in res0:
                if isinstance(line, (list, tuple)) and len(line) >= 2:
                    items.append({
                        "box": line[0],
                        "text": line[1][0],
                        "confidence": float(line[1][1])
                    })

    return {
        "success": True,
        "items": items,
        "full_text": "\n".join([i["text"] for i in items])
    }

