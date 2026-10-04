/**
 * Returns the Vega config that gives charts the host UI's fonts and palette.
 *
 * Vega's stock defaults are `sans-serif` at Vega sizes, which reads as a
 * foreign object inside this UI. Use when compiling a spec by hand; vegalite.render
 * applies it already. A spec's own `config` block is merged over this one, so a
 * chart can still override any of it.
 */
export default function (_ctx: Context, _session: Session | null, _opts?: {}): Record<string, unknown> {
    const font = "Inter, ui-sans-serif, system-ui, sans-serif";
    const text = "#1D2331";
    const muted = "#717684";
    const line = "#CCCED4";
    return {
        background: null,
        font,
        title: { font, fontSize: 14, fontWeight: 600, color: text, subtitleFont: font, subtitleColor: muted, anchor: "start", offset: 12 },
        axis: {
            labelFont: font, labelFontSize: 11, labelColor: muted,
            titleFont: font, titleFontSize: 12, titleFontWeight: 500, titleColor: text,
            domainColor: line, tickColor: line, gridColor: "#EDEEF1", gridWidth: 1, labelPadding: 6, tickSize: 4,
        },
        legend: {
            labelFont: font, labelFontSize: 11, labelColor: muted,
            titleFont: font, titleFontSize: 12, titleFontWeight: 500, titleColor: text,
            symbolType: "circle", symbolSize: 80,
        },
        header: { labelFont: font, labelFontSize: 11, labelColor: muted, titleFont: font, titleFontSize: 12, titleColor: text },
        view: { stroke: null, continuousWidth: 420, continuousHeight: 240, step: 24 },
        range: { category: ["#7DA1EF", "#F58685", "#78B58E", "#E4BE6F", "#AB8AE3", "#5FB8C4", "#D98FB8", "#9AA3B2"] },
        mark: { color: "#7DA1EF", tooltip: null },
        bar: { cornerRadiusTopLeft: 2, cornerRadiusTopRight: 2 },
        line: { strokeWidth: 2 },
        point: { filled: true, size: 60 },
        text: { font, fontSize: 11, fill: text },
    };
}
