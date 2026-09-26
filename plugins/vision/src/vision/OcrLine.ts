/** One recognized text line: normalized coordinates (0..1) with a top-left origin. */
export type OcrLine = {
    text: string;
    confidence: number;
    box: { x: number; y: number; w: number; h: number };
    /** Rotated corners: top-left, top-right, bottom-right, bottom-left. */
    quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
};
