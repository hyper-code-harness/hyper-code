/** A compiled reladraw diagram. */
export type Rendered = {
    /** Standalone SVG document. */
    svg: string;
    /** Natural drawing width in pixels. */
    width: number;
    /** Natural drawing height in pixels. */
    height: number;
};
