/** A bounded, pixel-sized flexbox subtree; text must be measured by the caller. */
export type FlexNode = {
    /** Unique nonempty identifier, including containers. */
    id: string;
    /** Ordered child blocks. @default [] */
    children?: types.svg.FlexNode[];
    /** Explicit border-box width in pixels; omitted means content-sized or stretched. @minimum 0 @maximum 1000000 */
    width?: number;
    /** Explicit border-box height in pixels; omitted means content-sized or stretched. @minimum 0 @maximum 1000000 */
    height?: number;
    /** Minimum width in pixels. @minimum 0 @maximum 1000000 */
    minWidth?: number;
    /** Maximum width in pixels, not below minWidth. @minimum 0 @maximum 1000000 */
    maxWidth?: number;
    /** Minimum height in pixels. @minimum 0 @maximum 1000000 */
    minHeight?: number;
    /** Maximum height in pixels, not below minHeight. @minimum 0 @maximum 1000000 */
    maxHeight?: number;
    /** Main axis for children. @default column */
    direction?: 'row' | 'column';
    /** Space between items and wrapped lines, in pixels. @default 0 @minimum 0 @maximum 1000000 */
    gap?: number;
    /** Uniform padding or individual edge padding in pixels; omitted edges are zero. @default 0 */
    padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
    /** Cross-axis alignment of child items. @default stretch */
    align?: 'start' | 'center' | 'end' | 'stretch';
    /** Main-axis distribution of child items. @default start */
    justify?: 'start' | 'center' | 'end' | 'space-between' | 'space-around' | 'space-evenly';
    /** Wrap overflowing children onto additional lines; lines start at the cross-axis start. @default false */
    wrap?: boolean;
    /** Share of positive free space allocated to this item. Uses its natural/explicit size as basis. @default 0 @minimum 0 @maximum 1000000 */
    grow?: number;
    /** Relative shrink weight when the parent lacks space. @default 0 @minimum 0 @maximum 1000000 */
    shrink?: number;
};
