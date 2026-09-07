import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';

/**
 * Structured extraction prompt for Legal Metrology compliance fields.
 * Instructs Gemini to return strict JSON — no prose.
 */
const COMPLIANCE_EXTRACTION_PROMPT = `You are a Legal Metrology compliance officer AI specializing in the Legal Metrology (Packaged Commodities) Rules, 2011 of India.

Analyze the provided image of a packaged commodity label/packaging and extract ONLY the following fields. Return STRICT JSON with exactly these keys (use null for any field not found):

{
  "manufacturer_name": "string | null",
  "manufacturer_address": "string | null",
  "pin_code": "string | null",
  "generic_name": "string | null",
  "net_quantity_value": "number | null",
  "net_quantity_unit": "g | kg | ml | L | N | null",
  "mrp_value": "number | null",
  "mrp_text_exact": "string | null",
  "mrp_includes_all_taxes": "boolean",
  "mrp_struck_through": "boolean",
  "promotional_pack": "boolean",
  "original_mrp_value": "number | null",
  "mfg_date": "string | null",
  "exp_date": "string | null",
  "country_of_origin": "string | null",
  "consumer_care_phone": "string | null",
  "consumer_care_email": "string | null",
  "consumer_care_name": "string | null",
  "toll_free_number": "string | null",
  "website": "string | null",
  "fssai_license": "string | null",
  "language_used": ["English" | "Hindi" | "Other"],
  "sticker_over_mrp_detected": "boolean",
  "prohibited_qualifiers_found": ["string"],
  "non_si_units_found": ["string"],
  "usp_value": "number | null",
  "usp_unit": "string | null",
  "batch_number": "string | null",
  "license_number": "string | null",
  "raw_extracted_text": "string"
}

Rules for extraction:
- net_quantity_unit: must be one of g, kg, ml, L, N — convert synonyms (ltr→L, gm→g)
- mrp_value: the CURRENT/EFFECTIVE MRP (even if printed on a sticker). If struck-through, still report its value.
- original_mrp_value: if you see an older/printed MRP that has been struck through or covered, report that value here.
- mrp_includes_all_taxes: true if label says "incl. of all taxes" or "inclusive of all taxes"
- mrp_struck_through: true if the MRP number has a strikethrough line drawn through it.
- promotional_pack: true if label says FREE, COMBO, OFFER, BONUS PACK, BUY X GET Y, or similar promotional text near MRP.
- sticker_over_mrp_detected: true if a physical adhesive sticker (different texture/color from base label) is pasted on top of a printed MRP to change its value. A printed promotional label section is NOT a sticker violation — only actual applied stickers are.
- prohibited_qualifiers_found: list any of these words found near quantity: minimum, not less than, average, about, approximately
- non_si_units_found: list if dozen, score, gross, great gross are found
- toll_free_number: extract 1800-xxx-xxxx type numbers
- website: extract website URL from label
- batch_number: look for Batch No., BT, LOT No.
- license_number: look for manufacturing licence number (M.C., MFG LIC, etc.)
- language_used: list all languages visually present
- raw_extracted_text: ALL text you can read from the image, verbatim

Return ONLY the JSON object. No markdown, no explanation.`;

export interface GeminiExtractionResult {
  manufacturer_name: string | null;
  manufacturer_address: string | null;
  pin_code: string | null;
  generic_name: string | null;
  net_quantity_value: number | null;
  net_quantity_unit: string | null;
  mrp_value: number | null;
  mrp_text_exact: string | null;
  mrp_includes_all_taxes: boolean;
  mfg_date: string | null;
  exp_date: string | null;
  country_of_origin: string | null;
  consumer_care_phone: string | null;
  consumer_care_email: string | null;
  consumer_care_name: string | null;
  fssai_license: string | null;
  language_used: string[];
  sticker_over_mrp_detected: boolean;
  prohibited_qualifiers_found: string[];
  non_si_units_found: string[];
  usp_value: number | null;
  usp_unit: string | null;
  raw_extracted_text: string;
}

const DEFAULT_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-pro-latest',
].filter(Boolean) as string[];

export async function analyzeImageWithGemini(
  base64Image: string,
  mimeType: string = 'image/jpeg'
): Promise<GeminiExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in environment');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;
  let responseText = '';

  for (const modelName of DEFAULT_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
      });

      const result = await model.generateContent([
        COMPLIANCE_EXTRACTION_PROMPT,
        {
          inlineData: {
            data: base64Image,
            mimeType,
          },
        },
      ]);

      responseText = result.response.text().trim();
      if (responseText) {
        break; // Success!
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[Gemini] Model ${modelName} failed (${err?.message?.slice(0, 120)}), trying next candidate...`);
    }
  }

  if (!responseText) {
    throw lastError || new Error('All Gemini model candidates failed to generate content');
  }

  // Strip markdown code fences if Gemini wraps in ```json
  const jsonStr = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  try {
    return JSON.parse(jsonStr) as GeminiExtractionResult;
  } catch {
    // Fallback: return minimal result with raw text
    console.error('Gemini JSON parse error. Raw response:', responseText.slice(0, 500));
    return {
      manufacturer_name: null,
      manufacturer_address: null,
      pin_code: null,
      generic_name: null,
      net_quantity_value: null,
      net_quantity_unit: null,
      mrp_value: null,
      mrp_text_exact: null,
      mrp_includes_all_taxes: false,
      mfg_date: null,
      exp_date: null,
      country_of_origin: null,
      consumer_care_phone: null,
      consumer_care_email: null,
      consumer_care_name: null,
      fssai_license: null,
      language_used: ['English'],
      sticker_over_mrp_detected: false,
      prohibited_qualifiers_found: [],
      non_si_units_found: [],
      usp_value: null,
      usp_unit: null,
      raw_extracted_text: responseText,
    };
  }
}

/**
 * Process OCR text (from Google Cloud Vision or PaddleOCR) with Gemini LLM
 * to map raw text into structured Legal Metrology fields.
 */
export async function analyzeOcrTextWithGemini(
  ocrText: string,
  base64Image?: string,
  mimeType: string = 'image/jpeg'
): Promise<GeminiExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in environment');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: unknown = null;
  let responseText = '';

  const prompt = `${COMPLIANCE_EXTRACTION_PROMPT}

OCR EXTRACTED TEXT FROM PACKAGING:
"""
${ocrText}
"""
Extract the compliance fields from the text (and image if provided). Return ONLY the strict JSON object.`;

  for (const modelName of DEFAULT_MODELS) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ],
      });

      const parts: any[] = [prompt];
      if (base64Image) {
        parts.push({
          inlineData: {
            data: base64Image,
            mimeType,
          },
        });
      }

      const result = await model.generateContent(parts);
      responseText = result.response.text().trim();
      if (responseText) break;
    } catch (err: any) {
      lastError = err;
      console.warn(`[Gemini OCR Text] Model ${modelName} failed (${err?.message?.slice(0, 120)}), trying next candidate...`);
    }
  }

  if (!responseText) {
    throw lastError || new Error('All Gemini model candidates failed to parse OCR text');
  }

  const jsonStr = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const parsed = JSON.parse(jsonStr) as GeminiExtractionResult;
    parsed.raw_extracted_text = ocrText || parsed.raw_extracted_text;
    return parsed;
  } catch {
    return {
      manufacturer_name: null,
      manufacturer_address: null,
      pin_code: null,
      generic_name: null,
      net_quantity_value: null,
      net_quantity_unit: null,
      mrp_value: null,
      mrp_text_exact: null,
      mrp_includes_all_taxes: false,
      mfg_date: null,
      exp_date: null,
      country_of_origin: null,
      consumer_care_phone: null,
      consumer_care_email: null,
      consumer_care_name: null,
      fssai_license: null,
      language_used: ['English'],
      sticker_over_mrp_detected: false,
      prohibited_qualifiers_found: [],
      non_si_units_found: [],
      usp_value: null,
      usp_unit: null,
      raw_extracted_text: ocrText || responseText,
    };
  }
}

