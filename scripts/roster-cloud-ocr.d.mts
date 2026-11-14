export interface GoogleVisionWord {
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
}

export interface NormalizedGoogleVisionOcrResult {
    text: string;
    words: GoogleVisionWord[];
    confidence: number;
}

export function normalizeGoogleVisionOcrResult(payload: unknown): NormalizedGoogleVisionOcrResult;
