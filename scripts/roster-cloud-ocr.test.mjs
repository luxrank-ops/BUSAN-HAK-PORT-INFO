import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeGoogleVisionOcrResult } from './roster-cloud-ocr.mjs';

test('Google Cloud Vision 응답은 정규화된 텍스트·단어 좌표·신뢰도로 변환한다', () => {
    const result = normalizeGoogleVisionOcrResult({
        responses: [{
            fullTextAnnotation: {
                text: '11/13 ONE MADRID',
                pages: [{ blocks: [{ paragraphs: [{ words: [
                    {
                        symbols: [{ text: 'ONE' }],
                        boundingBox: { vertices: [{ x: 10, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 40 }, { x: 10, y: 40 }] },
                        confidence: 0.96
                    },
                    {
                        symbols: [{ text: 'MADRID' }],
                        boundingBox: { vertices: [{ x: 80, y: 20 }, { x: 170, y: 20 }, { x: 170, y: 40 }, { x: 80, y: 40 }] },
                        confidence: 0.84
                    },
                    {
                        symbols: [{ text: 'bad' }],
                        boundingBox: { vertices: [{ x: 5, y: 5 }] },
                        confidence: 0.99
                    }
                ] }] }] }]
            }
        }]
    });
    assert.equal(result.text, '11/13 ONE MADRID');
    assert.deepEqual(result.words, [
        { text: 'ONE', bbox: { x0: 10, y0: 20, x1: 70, y1: 40 }, confidence: 96 },
        { text: 'MADRID', bbox: { x0: 80, y0: 20, x1: 170, y1: 40 }, confidence: 84 }
    ]);
    assert.equal(result.confidence, 90);
});

test('빈 Google Cloud Vision 응답은 빈 판독으로 유지한다', () => {
    assert.deepEqual(normalizeGoogleVisionOcrResult({ responses: [{}] }), { text: '', words: [], confidence: 0 });
});

test('온라인 OCR 엔드포인트는 기본 비활성, 인증·동의·요청 제한·이미지 크기를 확인한다', () => {
    const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    assert.match(server, /ROSTER_CLOUD_OCR_ENABLED === '1'/);
    assert.match(server, /verifyIdToken\(authorization\[1\]\)/);
    assert.match(server, /X-Roster-Ocr-Consent/);
    assert.match(server, /isScreenUnlockRateLimited\(ip, 'ocr', 5\)/);
    assert.match(server, /express\.raw\(\{ type: 'image\/jpeg', limit: '4mb' \}\)/);
    assert.match(server, /vision\.googleapis\.com\/v1\/images:annotate/);
    assert.doesNotMatch(server, /console\.(?:log|info)\([^\n]*(?:image\.toString|image\.toBase64)/i);
});
