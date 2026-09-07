#!/usr/bin/env python3
"""
CompliScan - PaddleOCR Runner
Accepts an image path as argument or stdin, runs PaddleOCR, outputs JSON lines.

Usage:
    python paddle_ocr.py <image_path>
"""

import sys
import json
import os

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path provided", "lines": []}))
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(json.dumps({"error": f"File not found: {image_path}", "lines": []}))
        sys.exit(1)

    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

    try:
        from paddleocr import PaddleOCR
    except ImportError:
        sys.stderr.write("paddleocr is not installed. Install with: pip install paddleocr paddlepaddle\n")
        print(json.dumps({
            "error": "paddleocr library not installed",
            "install_instruction": "pip install paddleocr paddlepaddle",
            "lines": []
        }))
        sys.exit(1)

    # Initialize PaddleOCR with English
    ocr = PaddleOCR(lang='en')
    results = ocr.ocr(image_path)

    lines = []
    if results and len(results) > 0:
        res0 = results[0]
        if hasattr(res0, "get") or isinstance(res0, dict):
            texts = res0.get("rec_texts", [])
            scores = res0.get("rec_scores", [])
            boxes = res0.get("rec_polys", []) or res0.get("rec_boxes", [])
            for idx, text in enumerate(texts):
                score = float(scores[idx]) if idx < len(scores) else 1.0
                box = boxes[idx].tolist() if idx < len(boxes) and hasattr(boxes[idx], "tolist") else []
                lines.append({
                    "text": str(text),
                    "confidence": round(score, 4),
                    "box": box
                })
        elif isinstance(res0, list):
            for line in res0:
                if isinstance(line, (list, tuple)) and len(line) >= 2:
                    lines.append({
                        "box": line[0],
                        "text": line[1][0],
                        "confidence": float(line[1][1])
                    })

    output = {
        "success": True,
        "count": len(lines),
        "lines": lines,
        "full_text": "\n".join([l["text"] for l in lines])
    }
    print(json.dumps(output))

if __name__ == "__main__":
    main()
