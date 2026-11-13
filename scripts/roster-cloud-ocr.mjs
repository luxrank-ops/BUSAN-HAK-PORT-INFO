/** Normalize Google Cloud Vision document OCR output for the browser roster parser. */
export function normalizeGoogleVisionOcrResult(payload) {
    const annotation = payload?.responses?.[0]?.fullTextAnnotation;
    const text = String(annotation?.text || payload?.responses?.[0]?.textAnnotations?.[0]?.description || '');
    const words = (annotation?.pages || []).flatMap((page) => page.blocks || [])
        .flatMap((block) => block.paragraphs || [])
        .flatMap((paragraph) => paragraph.words || [])
        .map((word) => {
            const vertices = word?.boundingBox?.vertices || [];
            const xs = vertices.map((point) => Number(point?.x) || 0);
            const ys = vertices.map((point) => Number(point?.y) || 0);
            return {
                text: (word?.symbols || []).map((symbol) => String(symbol?.text || '')).join(''),
                bbox: {
                    x0: xs.length ? Math.min(...xs) : 0,
                    y0: ys.length ? Math.min(...ys) : 0,
                    x1: xs.length ? Math.max(...xs) : 0,
                    y1: ys.length ? Math.max(...ys) : 0
                },
                confidence: Math.max(0, Math.min(100, (Number(word?.confidence) || 0) * 100))
            };
        })
        .filter((word) => word.text && word.bbox.x1 > word.bbox.x0 && word.bbox.y1 > word.bbox.y0);
    const confidence = words.length
        ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
        : 0;
    return { text, words, confidence };
}
