# CompliScan 🛡️
### Automated Legal Metrology & Regulatory Compliance Intelligence

CompliScan is an end-to-end computer vision and statutory compliance auditing platform built for the **Legal Metrology Act, 2009**, the **Legal Metrology (Packaged Commodities) Rules, 2011 (amended through 2023)**, the **Food Safety and Standards Act (FSSAI)**, and the **Consumer Protection Act, 2019**.

---

## 📖 Master Architecture & Research Documentation
For comprehensive architectural specifications, mathematical formulations, research benchmarks, and slide-deck mappings, refer to:
👉 **[`COMPLISCAN_MASTER_ARCHITECTURE_DOCUMENT.md`](./COMPLISCAN_MASTER_ARCHITECTURE_DOCUMENT.md)**

### Document Contents:
1. **Proposed Solution Workflow & Solution Architecture** (End-to-end inspection flow & diagrams)
2. **Technical Architecture & Algorithmic Pipeline** (In-Plane GS1 Optical Ruler, Canvas CLAHE-lite, Multi-Tiered OCR)
3. **System Architecture & Technology Stack** (React 19, Node Express Gateway, FastAPI PaddleOCR, Neon PostgreSQL)
4. **Key Engineering Challenges & Solutions** (Curved packaging, specular reflection, API fallbacks, zero-connectivity)
5. **Future Vision & Scalability Roadmap** (Native AR, GS1 DataKart API sync, Quick-Commerce Crawlers)
6. **Research Literature & Statutory References** (DBNet, SVTR, Rule 6/7/11/18 statutory citations)
7. **Research Gaps & Our Contributions** (Benchmarked against Commercial OCR, Pure LLMs, and Manual Inspection)
8. **Slide Mapping Guide** (Ready-to-use slide-by-slide structure for presentations)

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v20+
- **Python**: 3.11 (for PaddleOCR microservice)
- **Homebrew / System Dependencies**: `libomp`, `wget`

### 2. Microservice Environment Setup (PaddleOCR)
```bash
# Recommended Python 3.11 for ARM64 PaddlePaddle wheels
python3.11 -m venv .venv_paddle
source .venv_paddle/bin/activate
pip install -r services/requirements-paddle.txt
```

### 3. Backend Setup
```bash
cd apps/backend
cp .env.example .env
# Fill in NEON_DATABASE_URL and GEMINI_API_KEY in .env
npm install
npm run dev
```
*Note: The backend automatically manages and spawns the PaddleOCR microservice on port 8000.*

### 4. Web Application Setup
```bash
cd apps/web
npm install
npm run dev
```
Open `http://localhost:5173` to access the CompliScan inspector console.
