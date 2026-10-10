import { test, expect, describe } from "bun:test";
import element from "./element";
import sanitize from "./sanitize";
import render from "./render";
import tsx from "./tsx";
import measureText from "./measureText";
import label from "./label";
import layout from "./layout";
import bbox from "./bbox";
import connect from "./connect";
import fence from "./$fence_svg";
import { hint } from "./$fence_svg";

// Hand-built ctx: fns are opts-only (what the injecting Proxy exposes), so a
// function under test reaches its neighbours exactly as it does in the runtime.
const mkCtx = (settings: Record<string, unknown> = {}) => {
    const ctx: any = { state: {} };
    ctx.fns = {
        svg: {
            element: (o: any) => element(ctx, null, o),
            sanitize: (o: any) => sanitize(ctx, null, o),
            render: (o: any) => render(ctx, null, o),
            tsx: (o: any) => tsx(ctx, null, o),
            measureText: (o: any) => measureText(ctx, null, o),
            label: (o: any) => label(ctx, null, o),
            layout: (o: any) => layout(ctx, null, o),
            bbox: (o: any) => bbox(ctx, null, o),
            connect: (o: any) => connect(ctx, null, o),
        },
        settings: { get: async (o: any) => settings[o.key] },
        procs: { db: { select: async () => [{ k: "a", n: 2 }, { k: "b", n: 1 }] } },
    };
    return ctx as Context;
};

describe("svg.element", () => {
    test("JSX attribute spelling becomes SVG spelling", () => {
        const out = element(mkCtx(), null, { tag: "text", props: { fontSize: 12, textAnchor: "middle", className: "x" }, children: "hi" });
        expect(out.markup).toBe('<text font-size="12" text-anchor="middle" class="x">hi</text>');
    });

    test("viewBox and friends keep their camelCase — hyphenating them loses the drawing", () => {
        const out = element(mkCtx(), null, { tag: "svg", props: { viewBox: "0 0 10 10", preserveAspectRatio: "none", markerWidth: 8 } });
        expect(out.markup).toContain('viewBox="0 0 10 10"');
        expect(out.markup).toContain('preserveAspectRatio="none"');
        expect(out.markup).toContain('markerWidth="8"');
        expect(out.markup).not.toContain("view-box");
    });

    test("null, undefined and false disappear; nested arrays flatten", () => {
        const kid = element(mkCtx(), null, { tag: "circle", props: { r: 1 } });
        const out = element(mkCtx(), null, { tag: "g", props: { fill: null, stroke: undefined, hidden: false }, children: [null, [kid, false], undefined] });
        expect(out.markup).toBe("<g><circle r=\"1\"/></g>");
    });

    test("text is escaped, child elements are not", () => {
        const kid = element(mkCtx(), null, { tag: "rect", props: {} });
        const out = element(mkCtx(), null, { tag: "text", props: { "data-note": '"a" & b' }, children: ["<script>", kid] });
        expect(out.markup).toContain("&lt;script&gt;");
        expect(out.markup).toContain("&quot;a&quot; &amp; b");
        expect(out.markup).toContain("<rect/>");
    });

    test("a style object is serialized", () => {
        const out = element(mkCtx(), null, { tag: "g", props: { style: { strokeWidth: 2, fill: "#000" } } });
        expect(out.markup).toBe('<g style="stroke-width:2;fill:#000"></g>');
    });

    test("a tag or attribute that is not a name is refused", () => {
        expect(() => element(mkCtx(), null, { tag: "g><script", props: {} })).toThrow(/element name/);
        expect(() => element(mkCtx(), null, { tag: "g", props: { 'x" onload="alert(1)': 1 } })).toThrow(/attribute name/);
    });
});

describe("svg.sanitize", () => {
    const dangerous = [
        ["script", '<svg><script>fetch("http://evil")</script><circle r="1"/></svg>'],
        ["style", "<svg><style>body{display:none}</style><circle r=\"1\"/></svg>"],
        ["foreignobject", "<svg><foreignObject><div>x</div></foreignObject><circle r=\"1\"/></svg>"],
        ["event handler", '<svg onload="alert(1)"><circle r="1"/></svg>'],
        ["external reference", '<svg><image href="http://evil/x.png"/><circle r="1"/></svg>'],
    ] as const;
    for (const [what, markup] of dangerous) {
        test(`strips ${what}`, () => {
            const out = sanitize(mkCtx(), null, { svg: markup });
            expect(out.removed).toContain(what);
            expect(out.svg).toContain('<circle r="1"/>');
            expect(out.svg).not.toMatch(/evil|alert|display:none|<div>/);
        });
    }

    test("a reference inside the drawing or an inline image survives", () => {
        const out = sanitize(mkCtx(), null, { svg: '<svg><use href="#marker"/><rect fill="url(#grad)"/><image href="data:image/png;base64,AAA"/></svg>' });
        expect(out.removed).toEqual([]);
        expect(out.svg).toContain('href="#marker"');
        expect(out.svg).toContain("url(#grad)");
        expect(out.svg).toContain("data:image/png;base64");
    });

    test("the namespace is added, because without it a browser draws nothing", () => {
        expect(sanitize(mkCtx(), null, { svg: "<svg><circle r='1'/></svg>" }).svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    test("markup with no svg root is an error, not a silent blank", () => {
        expect(() => sanitize(mkCtx(), null, { svg: "<div>hello</div>" })).toThrow(/<svg> root/);
    });
});

describe("svg.render", () => {
    test("a sized drawing with no viewBox gets one, so it scales instead of being clipped", () => {
        const out = render(mkCtx(), null, { svg: '<svg width="200" height="100"><circle r="1"/></svg>' });
        expect(out.svg).toContain('viewBox="0 0 200 100"');
        expect(out.html).toStartWith('<div class="svg-figure">');
    });

    test("width and height overrides replace the drawing's own", () => {
        const out = render(mkCtx(), null, { svg: '<svg width="200" height="100" viewBox="0 0 200 100"><circle r="1"/></svg>', width: 400, height: 50 });
        expect(out.svg).toContain('width="400"');
        expect(out.svg).toContain('height="50"');
        expect(out.svg).toContain('viewBox="0 0 200 100"');
    });
});

describe("svg.tsx", () => {
    test("computes a drawing from data and returns markup", async () => {
        const out = await tsx(mkCtx(), null, {
            source: `const rows = await ctx.fns.procs.db.select({ sql: "select 1" });
                return <svg viewBox="0 0 10 10">{rows.map((r, i) => <rect x={i} width={r.n} fontSize={9}/>)}</svg>;`,
        });
        expect(out.svg).toBe('<svg viewBox="0 0 10 10"><rect x="0" width="2" font-size="9"/><rect x="1" width="1" font-size="9"/></svg>');
    });

    test("a local component is called like a component", async () => {
        const out = await tsx(mkCtx(), null, {
            source: `const Box = ({ x, label }) => <g><rect x={x} width={10} height={10}/><text x={x}>{label}</text></g>;
                return <svg><Box x={4} label="ok"/></svg>;`,
        });
        expect(out.svg).toBe('<svg><g><rect x="4" width="10" height="10"/><text x="4">ok</text></g></svg>');
    });

    test("source with no return is refused up front, because the transpiler drops a dangling expression", async () => {
        await expect(tsx(mkCtx(), null, { source: "<svg><circle r={1}/></svg>" })).rejects.toThrow(/must `return`/);
    });

    test("a syntax error and a throw inside both surface as messages", async () => {
        await expect(tsx(mkCtx(), null, { source: "return <svg>{(((}</svg>;" })).rejects.toThrow(/svg:/);
        await expect(tsx(mkCtx(), null, { source: "throw new Error('no data'); return <svg/>;" })).rejects.toThrow("no data");
    });

    test("returning something that is not an element is an error", async () => {
        await expect(tsx(mkCtx(), null, { source: "return 42;" })).rejects.toThrow(/must return a JSX element/);
    });

    test("a local `h` is a height, not the JSX factory", async () => {
        // The obvious factory name is the obvious name for a bar's height too,
        // and shadowing it failed halfway through a drawing that looked fine.
        const out = await tsx(mkCtx(), null, {
            source: `const h = 40, w = 10;
                return <svg viewBox="0 0 10 40"><rect width={w} height={h}/></svg>;`,
        });
        expect(out.svg).toBe('<svg viewBox="0 0 10 40"><rect width="10" height="40"/></svg>');
    });
});

describe("svg fence", () => {
    test("plain markup renders without executing anything", async () => {
        const html = await fence(mkCtx(), null, { source: '<svg width="20" height="10"><circle r="1"/></svg>', lang: "svg", info: "width=100" });
        expect(html).toContain('class="svg-figure"');
        expect(html).toContain('width="100"');
    });

    test("tsx is refused while svg.allowEval is off, and the code never runs", async () => {
        const ctx = mkCtx({ allowEval: false });
        await expect(fence(ctx, null, { source: "(ctx.state.ran = true); return <svg/>;", lang: "svg", info: "tsx" })).rejects.toThrow(/allowEval/);
        expect((ctx.state as any).ran).toBeUndefined();
    });

    test("tsx runs once enabled", async () => {
        const html = await fence(mkCtx({ allowEval: true }), null, { source: 'return <svg width={20} height={10}><circle r={1}/></svg>;', lang: "svg", info: "tsx" });
        expect(html).toContain("<circle r=\"1\"/>");
    });

    test("the prompt hint mentions tsx only when it is enabled", async () => {
        expect(await hint(mkCtx({ allowEval: false }))).not.toContain("tsx");
        expect(await hint(mkCtx({ allowEval: true }))).toContain("svg tsx");
    });
});

describe("svg.measureText", () => {
    test("a wider string measures wider, and scales with the font size", () => {
        const c = mkCtx();
        const short = measureText(c, null, { text: "hi", size: 12 }).width;
        const long = measureText(c, null, { text: "hello world", size: 12 }).width;
        expect(long).toBeGreaterThan(short);
        expect(measureText(c, null, { text: "hello", size: 24 }).width).toBeCloseTo(measureText(c, null, { text: "hello", size: 12 }).width * 2, 1);
    });

    test("an empty string is zero wide and a monospace run is exactly 0.6em", () => {
        expect(measureText(mkCtx(), null, { text: "", size: 12 }).width).toBe(0);
        expect(measureText(mkCtx(), null, { text: "abcde", size: 10, mono: true }).width).toBeCloseTo(30, 5);
    });

    test("the estimate is within a few percent of real Helvetica metrics", () => {
        // "Agent inspector" at 9px measures ~62.5px in a browser.
        expect(measureText(mkCtx(), null, { text: "Agent inspector", size: 9 }).width).toBeGreaterThan(56);
        expect(measureText(mkCtx(), null, { text: "Agent inspector", size: 9 }).width).toBeLessThan(69);
    });
});

describe("svg.label", () => {
    test("wraps on spaces and keeps every line inside maxWidth", () => {
        const r = label(mkCtx(), null, { text: "the quick brown fox jumps over the lazy dog", x: 0, y: 10, size: 10, maxWidth: 80 });
        expect(r.lines.length).toBeGreaterThan(1);
        for (const line of r.lines) expect(measureText(mkCtx(), null, { text: line, size: 10 }).width).toBeLessThanOrEqual(80);
    });

    test("every tspan repeats x, or lines after the first drift right", () => {
        const r = label(mkCtx(), null, { text: "one two three four", x: 42, y: 10, size: 10, maxWidth: 40 });
        expect([...r.node.markup.matchAll(/<tspan x="42"/g)].length).toBe(r.lines.length);
    });

    test("without maxWidth it is one line, and a newline still breaks it", () => {
        expect(label(mkCtx(), null, { text: "a very long single line of text", x: 0, y: 0 }).lines.length).toBe(1);
        expect(label(mkCtx(), null, { text: "a\nb", x: 0, y: 0 }).lines).toEqual(["a", "b"]);
    });
});

describe("svg.layout", () => {
    test("a column stacks by height plus gap", () => {
        const r = layout(mkCtx(), null, { items: [{ h: 20 }, { h: 30 }, { h: 10 }], y: 5, gap: 4, direction: "column" });
        expect(r.boxes.map(b => b.y)).toEqual([5, 29, 63]);
        expect(r.height).toBe(68);
    });

    test("a row advances by width and reports the centre of each box", () => {
        const r = layout(mkCtx(), null, { items: [{ w: 10 }, { w: 20 }], x: 0, direction: "row", gap: 5, itemHeight: 8 });
        expect(r.boxes.map(b => b.x)).toEqual([0, 15]);
        expect(r.boxes[1]!.cx).toBe(25);
        expect(r.width).toBe(35);
    });

    test("stretch gives every item the width of the widest", () => {
        const r = layout(mkCtx(), null, { items: [{ w: 10 }, { w: 40 }], align: "stretch" });
        expect(r.boxes.map(b => b.w)).toEqual([40, 40]);
    });

    test("an empty list is a zero-sized arrangement, not a negative one", () => {
        const r = layout(mkCtx(), null, { items: [] });
        expect(r.boxes).toEqual([]);
        expect(r.height).toBe(0);
    });
});

describe("svg.bbox", () => {
    test("content inside the viewBox fits", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 100 100"><rect x="10" y="10" width="20" height="20"/></svg>' });
        expect(r.fits).toBe(true);
        expect(r.content).toMatchObject({ minX: 10, maxX: 30 });
    });

    test("content past the edge is reported with the side and the amount", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 100 50"><rect x="10" y="10" width="200" height="20"/></svg>' });
        expect(r.fits).toBe(false);
        expect(r.overflow.right).toBe(110);
        expect(r.overflow.left).toBe(0);
    });

    test("a label that runs off the edge is caught, which is the whole point", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 60 30"><text x="5" y="20" font-size="12">a rather long caption</text></svg>' });
        expect(r.fits).toBe(false);
        expect(r.overflow.right).toBeGreaterThan(40);
    });

    test("circles, lines and paths all count towards the bounds", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/><line x1="0" y1="0" x2="90" y2="5"/><path d="M 5 5 L 95 120"/></svg>' });
        expect(r.content!.maxY).toBe(120);
        expect(r.content!.minX).toBe(0);
    });

    test("suggestedViewBox would hold the content with its padding", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 10 10"><rect x="0" y="0" width="50" height="40"/></svg>', padding: 5 });
        expect(r.suggestedViewBox).toBe("-5 -5 60 50");
    });

    test("an empty drawing has no content and does not claim an overflow", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 10 10"></svg>' });
        expect(r.content).toBeNull();
        expect(r.fits).toBe(true);
    });
});

describe("svg.connect", () => {
    test("the arrow starts and ends on the borders, not the centres", () => {
        const r = connect(mkCtx(), null, { from: { x: 0, y: 0, w: 20, h: 20 }, to: { x: 100, y: 0, w: 20, h: 20 }, gap: 0 });
        expect(r.start.x).toBe(20);
        expect(r.end.x).toBe(100);
        expect(r.start.y).toBe(10);
    });

    test("the head is a polygon, so two connectors never share a marker id", () => {
        const one = connect(mkCtx(), null, { from: { x: 0, y: 0, w: 10, h: 10 }, to: { x: 50, y: 0, w: 10, h: 10 } });
        expect(one.node.markup).toContain("<polygon");
        expect(one.node.markup).not.toContain("marker");
    });

    test("head none draws no arrowhead and both draws two", () => {
        const none = connect(mkCtx(), null, { from: { x: 0, y: 0, w: 10, h: 10 }, to: { x: 50, y: 0, w: 10, h: 10 }, head: "none" });
        const both = connect(mkCtx(), null, { from: { x: 0, y: 0, w: 10, h: 10 }, to: { x: 50, y: 0, w: 10, h: 10 }, head: "both" });
        expect(none.node.markup).not.toContain("<polygon");
        expect([...both.node.markup.matchAll(/<polygon/g)].length).toBe(2);
    });

    test("an orthogonal connector turns instead of going diagonally", () => {
        const r = connect(mkCtx(), null, { from: { x: 0, y: 0, w: 10, h: 10 }, to: { x: 100, y: 100, w: 10, h: 10 }, style: "orthogonal" });
        expect([...r.node.markup.matchAll(/ L /g)].length).toBeGreaterThan(1);
    });

    test("a label gets a plate behind it so it stays readable over the line", () => {
        const r = connect(mkCtx(), null, { from: { x: 0, y: 0, w: 10, h: 10 }, to: { x: 100, y: 0, w: 10, h: 10 }, label: "calls" });
        expect(r.node.markup).toContain("calls");
        expect(r.node.markup).toContain("<rect");
    });
});

describe("svg.bbox and wrapped text", () => {
    test("a tspan inherits the text's baseline and font size, instead of sitting at y=0", () => {
        const c = mkCtx();
        const node = label(c, null, { text: "one two three four five", x: 10, y: 100, size: 10, maxWidth: 40 });
        const r = bbox(c, null, { svg: `<svg viewBox="0 0 300 300">${node.node.markup}</svg>` });
        expect(r.content!.minY).toBeGreaterThan(80);
        expect(r.overflow.top).toBe(0);
    });

    test("a tspan inherits text-anchor, so a right-aligned label is not measured to the right", () => {
        const c = mkCtx();
        const node = label(c, null, { text: "alpha beta gamma", x: 200, y: 50, size: 10, maxWidth: 40, anchor: "end" });
        const r = bbox(c, null, { svg: `<svg viewBox="0 0 300 300">${node.node.markup}</svg>` });
        expect(r.content!.maxX).toBeLessThanOrEqual(201);
    });
});

describe("svg.bbox and path commands", () => {
    test("a relative path is followed, not read as a list of absolute pairs", () => {
        // "l -5 6" is an offset from (30,30); read naively it looks like a point
        // at (-5,6) and invents an overflow off the left edge.
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 100 100"><path d="M 30 30 l -5 6 l 5 6"/></svg>' });
        expect(r.content!.minX).toBe(25);
        expect(r.fits).toBe(true);
    });

    test("H and V carry one coordinate each and do not shift the pairs after them", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 100 100"><path d="M 10 10 V 40 H 60 L 20 20"/></svg>' });
        expect(r.content).toMatchObject({ minX: 10, minY: 10, maxX: 60, maxY: 40 });
        expect(r.fits).toBe(true);
    });
});
