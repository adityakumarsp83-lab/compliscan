/**
 * Google Cloud Vision API Client
 * Uses the REST API endpoint: https://vision.googleapis.com/v1/images:annotate?key=API_KEY
 * Provides raw text extraction, word bounding boxes, and pipeline to LLM.
 */

export interface GoogleVisionTextAnnotation {
  description: string;
  boundingPoly?: {
    vertices: Array<{ x?: number; y?: number }>;
  };
}

export interface GoogleVisionResponse {
  rawText: string;
  annotations: GoogleVisionTextAnnotation[];
}

/**
 * Call Google Cloud Vision API directly using an API key.
 */
export async function annotateWithGoogleVision(base64Image: string): Promise<GoogleVisionResponse> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey || apiKey === 'your_google_vision_api_key_here') {
    throw new Error('GOOGLE_VISION_API_KEY not configured in backend/.env');
  }

  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

  const requestBody = {
    requests: [
      {
        image: {
          content: base64Image,
        },
        features: [
          {
            type: 'DOCUMENT_TEXT_DETECTION',
            maxResults: 1,
          },
        ],
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Cloud Vision API error [${response.status}]: ${errorText}`);
  }

  const data: any = await response.json();
  const res = data.responses?.[0];

  if (res?.error) {
    throw new Error(`Google Cloud Vision API returned error: ${res.error.message || JSON.stringify(res.error)}`);
  }

  const rawText: string = res?.fullTextAnnotation?.text || res?.textAnnotations?.[0]?.description || '';
  const annotations: GoogleVisionTextAnnotation[] = res?.textAnnotations || [];

  return {
    rawText,
    annotations,
  };
}
