// A mixin: named design atoms as plain data. Every value is a name from the principles, never a number,
// so merging two mixins with object spread is the whole composition story: { ...caption, gap: "inside" }.
export type Space = "s1" | "s2" | "s3" | "s4" | "s6" | "inside" | "edge";
export type Mixin = {
    /** Layout: a column, a centred row, or a grid. */
    layout?: "stack" | "row" | "grid";
    /** Space between children. */
    gap?: Space;
    /** Padding on all sides. */
    pad?: Space;
    /** Padding left and right. */
    padX?: Space;
    /** Padding top and bottom. */
    padY?: Space;
    /** Cross-axis alignment. */
    align?: "start" | "center" | "end" | "stretch";
    /** Main-axis distribution. */
    justify?: "start" | "center" | "between" | "end";
    /** Children wrap onto new lines. */
    wrap?: boolean;
    /** Take the remaining space and allow shrinking. */
    grow?: boolean;
    /** Scroll the overflow. */
    scroll?: boolean;
    /** Type size: ui 13, read 14, small 11 (principle 5). */
    text?: "ui" | "read" | "small";
    /** Weight: normal 400, strong 500. */
    weight?: "normal" | "strong";
    /** Text shade: main, secondary, quiet. */
    ink?: "base" | "muted" | "faint";
    /** Monospace, for literal text only. */
    mono?: boolean;
    /** The section caption role (EXPLORER-style): 11px, 500, quiet grey, spaced capitals. The only caps there is. */
    caption?: boolean;
    /** Literal text: keep its line breaks and wrap long words instead of widening the page. */
    pre?: boolean;
    /** Push to the end of its row (the controls after a title). */
    end?: boolean;
    /** One line with an ellipsis. */
    truncate?: boolean;
    /** Corner by level (principle 12): frame 0, item 6, window 12, round. */
    radius?: "frame" | "item" | "window" | "round";
    /** Where the one rule goes: around the block, on one side, or between children (principle: between, not around). */
    line?: "around" | "top" | "bottom" | "start" | "end" | "between";
    /** The one shadow, for what pops up or lies over the window. */
    raised?: boolean;
};
