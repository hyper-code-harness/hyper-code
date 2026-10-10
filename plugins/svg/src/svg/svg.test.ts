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
import grid from "./grid";
import anchor from "./anchor";
import icon from "./icon";
import fitText from "./fitText";
import debugOverlay from "./debug";
import stack from "./stack";
import theme from "./theme";
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
            grid: (o: any) => grid(ctx, null, o),
            anchor: (o: any) => anchor(ctx, null, o),
            icon: (o: any) => icon(ctx, null, o),
            fitText: (o: any) => fitText(ctx, null, o),
            debug: (o: any) => debugOverlay(ctx, null, o),
            stack: (o: any) => stack(ctx, null, o),
            theme: (o: any) => theme(ctx, null, o),
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

describe("svg.grid", () => {
    test("fr tracks split what fixed tracks leave", () => {
        const g = grid(mkCtx(), null, { cols: [40, "1fr", "2fr"], rows: ["1fr"], width: 340, height: 100, gap: 0 });
        expect(g.colSizes).toEqual([40, 100, 200]);
    });

    test("gaps come out of the free space, not out of the region", () => {
        const g = grid(mkCtx(), null, { cols: ["1fr", "1fr"], rows: ["1fr"], width: 100, height: 10, gap: 20 });
        expect(g.colSizes).toEqual([40, 40]);
        expect(g.cell({ col: 1 }).x).toBe(60);
    });

    test("a span swallows the gap inside it, the way CSS grid does", () => {
        const g = grid(mkCtx(), null, { cols: ["1fr", "1fr", "1fr"], rows: ["1fr"], width: 100 + 2 * 10, height: 10, gap: 10 });
        const two = g.cell({ col: 0, colSpan: 2 });
        expect(two.w).toBe(100 / 3 * 2 + 10);
    });

    test("percentages and auto resolve against the same free space", () => {
        const g = grid(mkCtx(), null, { cols: ["25%", "auto", "auto"], rows: ["1fr"], width: 200, height: 10 });
        expect(g.colSizes[0]).toBe(50);
        expect(g.colSizes[1]).toBe(75);
    });

    test("pad insets a cell on every side, which is a card's margin", () => {
        const g = grid(mkCtx(), null, { cols: ["1fr"], rows: ["1fr"], width: 100, height: 100 });
        const c = g.cell({ pad: 10 });
        expect([c.x, c.y, c.w, c.h]).toEqual([10, 10, 80, 80]);
    });

    test("a named area is the bounding box of every cell that carries the name", () => {
        const g = grid(mkCtx(), null, {
            cols: ["1fr", "1fr", "1fr"], rows: [20, 60],
            width: 300, height: 80,
            areas: ["head head head", "nav main main"],
        });
        expect(g.area("head")).toMatchObject({ x: 0, y: 0, w: 300, h: 20 });
        expect(g.area("main")).toMatchObject({ x: 100, y: 20, w: 200, h: 60 });
        expect(g.area("nav").w).toBe(100);
    });

    test("an unknown area is an error, not a silent box at the origin", () => {
        const g = grid(mkCtx(), null, { cols: ["1fr"], rows: ["1fr"], width: 10, height: 10, areas: ["a"] });
        expect(() => g.area("b")).toThrow(/no grid area/);
    });

    test("a full-width span reaches the last column exactly", () => {
        const g = grid(mkCtx(), null, { cols: ["1fr", "1fr"], rows: ["1fr"], width: 100, height: 10 });
        expect(g.cell({ col: 0, colSpan: 2 }).right).toBe(100);
    });

    test("a grid nests inside a cell of another one", () => {
        const outer = grid(mkCtx(), null, { cols: ["1fr", "1fr"], rows: ["1fr"], width: 200, height: 100 });
        const right = outer.cell({ col: 1 });
        const inner = grid(mkCtx(), null, { cols: ["1fr"], rows: ["1fr", "1fr"], x: right.x, y: right.y, width: right.w, height: right.h });
        expect(inner.cell({ row: 1 }).y).toBe(50);
        expect(inner.cell({ row: 1 }).x).toBe(100);
    });
});

describe("svg.anchor", () => {
    const card = { x: 100, y: 100, w: 80, h: 40 };

    test("a named point is the point of the box it names", () => {
        expect(anchor(mkCtx(), null, { of: card, at: "bottom-left" })).toMatchObject({ x: 100, y: 140 });
        expect(anchor(mkCtx(), null, { of: card, at: "center" })).toMatchObject({ x: 140, y: 120 });
    });

    test("below pushes down by the gap, above pushes up", () => {
        expect(anchor(mkCtx(), null, { of: card, at: "bottom-left", place: "below", gap: 8 }).y).toBe(148);
        expect(anchor(mkCtx(), null, { of: card, at: "top", place: "above", gap: 8 }).y).toBe(92);
    });

    test("inside turns the gap into padding towards the middle", () => {
        const p = anchor(mkCtx(), null, { of: card, at: "top-left", place: "inside", gap: 6 });
        expect(p).toMatchObject({ x: 106, y: 106 });
    });

    test("a sized box is placed beside the source and never covers it", () => {
        const b = anchor(mkCtx(), null, { of: card, at: "right", place: "right-of", gap: 12, size: { w: 50, h: 20 }, align: "center" }).box!;
        expect(b.x).toBe(192);
        expect(b.cy).toBe(120);
        expect(b.x).toBeGreaterThanOrEqual(card.x + card.w);
    });

    test("a box placed below starts at the edge and spans downwards", () => {
        const b = anchor(mkCtx(), null, { of: card, at: "bottom-left", place: "below", gap: 4, size: { w: 80, h: 16 } }).box!;
        expect(b.y).toBe(144);
        expect(b.bottom).toBe(160);
    });

    test("without a size there is no box, only the point", () => {
        expect(anchor(mkCtx(), null, { of: card, at: "top" }).box).toBeNull();
    });
});

describe("svg.icon", () => {
    // A ctx whose db already holds the icon, so the test never touches the network.
    const iconCtx = (rows: any[] = [{ body: '<path fill="currentColor" d="M1 1"/>', width: 256, height: 256 }]) => {
        const ctx: any = { state: {} };
        ctx.queries = [];
        ctx.fns = {
            svg: { element: (o: any) => element(ctx, null, o), icon: (o: any) => icon(ctx, null, o) },
            procs: { db: { select: async (o: any) => (ctx.queries.push(o), rows), run: async (o: any) => ctx.queries.push(o) } },
        };
        return ctx as Context;
    };

    test("a cached icon is scaled from its own grid to the asked size", async () => {
        const r = await icon(iconCtx(), null, { name: "paperclip", size: 16, x: 10, y: 20 });
        // 256-unit grid drawn at 16px is a scale of 1/16.
        expect(r.node.markup).toContain('transform="translate(10 20) scale(0.0625)"');
        expect(r.box).toMatchObject({ x: 10, y: 20, w: 16, h: 16, cx: 18 });
    });

    test("colour is set through `color`, or currentColor stays black", async () => {
        const r = await icon(iconCtx(), null, { name: "paperclip", color: "#888" });
        expect(r.node.markup).toContain('color="#888"');
    });

    test("the body is inlined as markup, not escaped into visible text", async () => {
        const r = await icon(iconCtx(), null, { name: "paperclip" });
        expect(r.node.markup).toContain("<path");
        expect(r.node.markup).not.toContain("&lt;path");
    });

    test("a prefixed name carries its own set, like everywhere else in Iconify", async () => {
        const ctx = iconCtx();
        await icon(ctx, null, { name: "tabler:database" });
        expect((ctx as any).queries[0].params).toEqual(["tabler", "database"]);
    });

    test("an empty name is an error rather than an empty drawing", async () => {
        await expect(icon(iconCtx(), null, { name: "  " })).rejects.toThrow(/needs a name/);
    });

    test("a missing icon says which set it looked in", async () => {
        const ctx: any = { state: {} };
        ctx.fns = {
            svg: { element: (o: any) => element(ctx, null, o) },
            procs: { db: { select: async () => [], run: async () => {} } },
        };
        const original = globalThis.fetch;
        globalThis.fetch = (async () => new Response(JSON.stringify({ icons: {} }), { status: 200 })) as any;
        try {
            await expect(icon(ctx as Context, null, { name: "nope", set: "ph" })).rejects.toThrow(/no icon "nope" in set "ph"/);
        } finally { globalThis.fetch = original; }
    });
});

describe("svg.bbox and transforms", () => {
    test("a translated group is measured where it lands, not where it was written", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 200 200"><g transform="translate(100 50)"><rect x="0" y="0" width="20" height="20"/></g></svg>' });
        expect(r.content).toMatchObject({ minX: 100, minY: 50, maxX: 120, maxY: 70 });
    });

    test("a scaled icon body is measured at its drawn size, not its own grid", () => {
        // 256-unit icon drawn at 16px, the exact case that reported a false overflow.
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 100 100"><g transform="translate(10 10) scale(0.0625)"><path d="M 0 0 L 256 256"/></g></svg>' });
        expect(r.content).toMatchObject({ minX: 10, minY: 10, maxX: 26, maxY: 26 });
        expect(r.fits).toBe(true);
    });

    test("a transform stops applying after its group closes", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 200 200"><g transform="translate(100 100)"><rect x="0" y="0" width="10" height="10"/></g><rect x="0" y="0" width="5" height="5"/></svg>' });
        expect(r.content).toMatchObject({ minX: 0, minY: 0, maxX: 110 });
    });

    test("nested transforms compose", () => {
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 400 400"><g transform="translate(100 0)"><g transform="translate(50 20)"><rect x="0" y="0" width="10" height="10"/></g></g></svg>' });
        expect(r.content).toMatchObject({ minX: 150, minY: 20 });
    });
});

describe("svg.fitText", () => {
    const box = { x: 10, y: 20, w: 120, h: 40 };

    test("text that already fits keeps its size and says so", () => {
        const r = fitText(mkCtx(), null, { text: "ok", box, size: 12 });
        expect(r.size).toBe(12);
        expect(r.fits).toBe(true);
        expect(r.lines).toEqual(["ok"]);
    });

    test("shrink steps the font down until the lines fit the height", () => {
        const r = fitText(mkCtx(), null, { text: "a long caption that will need several lines to fit inside this narrow card", box, size: 12, minSize: 6 });
        expect(r.size).toBeLessThan(12);
        expect(r.fits).toBe(true);
    });

    test("shrink stops at minSize and reports what still does not fit", () => {
        const r = fitText(mkCtx(), null, { text: "word ".repeat(80), box: { x: 0, y: 0, w: 60, h: 20 }, size: 12, minSize: 11 });
        expect(r.size).toBe(11);
        expect(r.fits).toBe(false);
        expect(r.overflowBy.y).toBeGreaterThan(0);
    });

    test("ellipsis cuts the last kept line, not the end of the string", () => {
        const r = fitText(mkCtx(), null, { text: "one two three four five six seven eight nine", box: { x: 0, y: 0, w: 70, h: 30 }, size: 10, overflow: "ellipsis" });
        expect(r.lines.at(-1)!.endsWith("…")).toBe(true);
        expect(r.lines.length).toBeLessThanOrEqual(3);
    });

    test("ellipsis-middle keeps both ends, which is what a path needs", () => {
        const r = fitText(mkCtx(), null, { text: "plugins/svg/src/svg/measureText.ts", box: { x: 0, y: 0, w: 90, h: 14 }, size: 10, overflow: "ellipsis-middle" });
        expect(r.lines[0]).toContain("…");
        expect(r.lines[0]!.startsWith("p")).toBe(true);
        expect(r.lines[0]!.endsWith(".ts")).toBe(true);
    });

    test("maxLines caps the line count whatever the box allows", () => {
        const r = fitText(mkCtx(), null, { text: "one two three four five six seven eight", box: { x: 0, y: 0, w: 60, h: 400 }, size: 10, maxLines: 2, overflow: "clip" });
        expect(r.lines.length).toBe(2);
    });

    test("none draws as asked and only reports the overflow", () => {
        const r = fitText(mkCtx(), null, { text: "word ".repeat(40), box: { x: 0, y: 0, w: 60, h: 20 }, size: 12, overflow: "none" });
        expect(r.size).toBe(12);
        expect(r.fits).toBe(false);
    });

    test("width/height spellings are accepted like w/h", () => {
        const r = fitText(mkCtx(), null, { text: "ok", box: { x: 0, y: 0, width: 100, height: 30 }, size: 10 });
        expect(r.fits).toBe(true);
    });

    test("a box with no width is an error, not a division by zero", () => {
        expect(() => fitText(mkCtx(), null, { text: "x", box: { x: 0, y: 0, w: 0, h: 10 } })).toThrow(/positive width/);
    });

    test("valign center places the text in the middle of the box", () => {
        const r = fitText(mkCtx(), null, { text: "ok", box: { x: 0, y: 0, w: 100, h: 50 }, size: 10, valign: "center" });
        expect(r.box.y).toBeGreaterThan(10);
        expect(r.box.y).toBeLessThan(30);
    });
});

describe("svg.grid validation", () => {
    const g = () => grid(mkCtx(), null, { cols: ["1fr", "1fr", "1fr"], rows: ["1fr", "1fr"], width: 300, height: 100 });

    test("a column past the last one is an error naming the range", () => {
        expect(() => g().cell({ col: 9 })).toThrow(/3 columns \(0\.\.2\), asked for col 9/);
    });

    test("a row past the last one is an error too", () => {
        expect(() => g().cell({ row: 5 })).toThrow(/2 rows/);
    });

    test("a span running off the edge is an error, not a clamp", () => {
        expect(() => g().cell({ col: 2, colSpan: 2 })).toThrow(/runs past the last column/);
    });

    test("an areas row that disagrees with the columns is an error", () => {
        expect(() => grid(mkCtx(), null, { cols: ["1fr", "1fr"], rows: ["1fr"], width: 100, height: 10, areas: ["a b c"] }))
            .toThrow(/names 3 cells but the grid has 2 columns/);
    });

    test("an unknown area name lists the ones that exist", () => {
        const withAreas = grid(mkCtx(), null, { cols: ["1fr"], rows: ["1fr"], width: 10, height: 10, areas: ["head"] });
        expect(() => withAreas.area("foot")).toThrow(/have: head/);
    });

    test("a cell carries both spellings of its size, so it spreads onto a rect", () => {
        const c = g().cell({ col: 1 });
        expect(c.width).toBe(c.w);
        expect(c.height).toBe(c.h);
    });
});

describe("svg.debug", () => {
    test("a grid overlay outlines every cell and numbers it", () => {
        const g = grid(mkCtx(), null, { cols: ["1fr", "1fr"], rows: ["1fr"], width: 200, height: 50 });
        const r = debugOverlay(mkCtx(), null, { grid: g });
        // One outline for the region plus one per cell.
        expect(r.node.markup.match(/<rect/g)!.length).toBe(3);
        expect(r.node.markup).toContain("0,0 100×50");
        expect(r.node.markup).toContain("1,0");
    });

    test("boxes are outlined with their size, or a given label", () => {
        const r = debugOverlay(mkCtx(), null, { boxes: [{ x: 0, y: 0, w: 40, h: 20 }, { x: 0, y: 0, width: 10, height: 10, label: "card" }] });
        expect(r.node.markup).toContain("40×20");
        expect(r.node.markup).toContain("card");
    });

    test("points are marked with a cross", () => {
        const r = debugOverlay(mkCtx(), null, { points: [{ x: 50, y: 60, label: "a" }] });
        expect(r.node.markup).toContain("M 46 60 H 54 M 50 56 V 64");
    });

    test("labels can be turned off for a clean overlay", () => {
        const r = debugOverlay(mkCtx(), null, { boxes: [{ x: 0, y: 0, w: 10, h: 10 }], labels: false });
        expect(r.node.markup).not.toContain("<text");
    });
});

describe("svg.label exact width", () => {
    test("exact pins each line to its measured width", () => {
        const r = label(mkCtx(), null, { text: "Сообщение агенту", x: 10, y: 20, size: 12, exact: true });
        expect(r.node.markup).toMatch(/textLength="[\d.]+"/);
        expect(r.node.markup).toContain('lengthAdjust="spacing"');
    });

    test("every wrapped line gets its own length, not the longest one", () => {
        const r = label(mkCtx(), null, { text: "длинная строка которая переносится", x: 0, y: 12, size: 10, maxWidth: 90, exact: true });
        const lengths = [...r.node.markup.matchAll(/textLength="([\d.]+)"/g)].map(m => Number(m[1]));
        expect(lengths.length).toBe(r.lines.length);
        expect(new Set(lengths).size).toBeGreaterThan(1);
    });

    test("without exact the markup stays as it was", () => {
        const r = label(mkCtx(), null, { text: "plain", x: 0, y: 10 });
        expect(r.node.markup).not.toContain("textLength");
    });

    test("a pinned width survives sanitizing, or the promise is void", () => {
        const r = label(mkCtx(), null, { text: "Проверка", x: 0, y: 10, exact: true });
        const clean = sanitize(mkCtx(), null, { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 20">${r.node.markup}</svg>` });
        expect(clean.svg).toContain("textLength");
        expect(clean.removed).toEqual([]);
    });

    test("bbox trusts a pinned width instead of re-estimating it", () => {
        // A deliberately wrong textLength: bbox must report what will be drawn.
        const r = bbox(mkCtx(), null, { svg: '<svg viewBox="0 0 400 40"><text x="0" y="20" font-size="12" textLength="300">short</text></svg>' });
        expect(r.content!.maxX).toBe(300);
    });

    test("fitText pins by default, so `fits` holds in any font", () => {
        const r = fitText(mkCtx(), null, { text: "Длинная подпись карточки", box: { x: 0, y: 0, w: 120, h: 40 }, size: 11 });
        expect(r.node.markup).toContain("textLength");
        expect(r.fits).toBe(true);
    });
});

describe("svg.stack", () => {
    const three = [{ w: 40, h: 20 }, { w: 40, h: 20 }, { w: 40, h: 20 }];
    const region = { x: 0, y: 0, w: 300, h: 50 };

    test("without a box it is a plain row from a point", () => {
        const r = stack(mkCtx(), null, { items: three, x: 10, y: 5, gap: 10 });
        expect(r.boxes.map(b => b.x)).toEqual([10, 60, 110]);
        expect(r.boxes[0]!.y).toBe(5);
    });

    test("space-between hands the slack to the gaps, ends stay put", () => {
        const r = stack(mkCtx(), null, { items: three, box: region, justify: "space-between", gap: 0 });
        expect(r.boxes[0]!.x).toBe(0);
        expect(r.boxes.at(-1)!.right).toBe(300);
        expect(r.boxes[1]!.cx).toBe(150);
    });

    test("center moves the whole block, keeping the gaps", () => {
        const r = stack(mkCtx(), null, { items: three, box: region, justify: "center", gap: 10 });
        const span = r.boxes.at(-1)!.right - r.boxes[0]!.x;
        expect(span).toBe(140);
        expect(r.boxes[0]!.x).toBe((300 - 140) / 2);
    });

    test("end pushes the block against the far edge", () => {
        const r = stack(mkCtx(), null, { items: three, box: region, justify: "end", gap: 10 });
        expect(r.boxes.at(-1)!.right).toBe(300);
    });

    test("space-around leaves a half gap at each end", () => {
        const r = stack(mkCtx(), null, { items: three, box: region, justify: "space-around", gap: 0 });
        expect(r.boxes[0]!.x).toBeGreaterThan(0);
        expect(r.boxes[0]!.x).toBeCloseTo(300 - r.boxes.at(-1)!.right, 5);
    });

    test("fill makes items share the room equally", () => {
        const r = stack(mkCtx(), null, { items: three, box: region, fill: true, gap: 10 });
        expect(r.boxes.map(b => b.w)).toEqual([(300 - 20) / 3, (300 - 20) / 3, (300 - 20) / 3]);
        expect(r.boxes.at(-1)!.right).toBeCloseTo(300, 5);
    });

    test("align center centres items across the axis", () => {
        const r = stack(mkCtx(), null, { items: [{ w: 20, h: 10 }, { w: 20, h: 30 }], box: region, align: "center" });
        expect(r.boxes[0]!.cy).toBe(r.boxes[1]!.cy);
    });

    test("stretch gives every item the full cross size", () => {
        const r = stack(mkCtx(), null, { items: three, box: region, align: "stretch" });
        expect(r.boxes.every(b => b.h === 50)).toBe(true);
    });

    test("wrap starts a new line when an item would overflow", () => {
        const r = stack(mkCtx(), null, { items: Array.from({ length: 5 }, () => ({ w: 80, h: 20 })), box: { x: 0, y: 0, w: 200, h: 100 }, gap: 10, wrap: true });
        expect(r.boxes.map(b => b.line)).toEqual([0, 0, 1, 1, 2]);
        expect(r.boxes[2]!.x).toBe(0);
        expect(r.boxes[2]!.y).toBe(30);
    });

    test("a column stacks downwards and justifies vertically", () => {
        const r = stack(mkCtx(), null, { items: three, box: { x: 0, y: 0, w: 60, h: 200 }, direction: "column", justify: "space-between", gap: 0 });
        expect(r.boxes[0]!.y).toBe(0);
        expect(r.boxes.at(-1)!.bottom).toBe(200);
        expect(r.boxes.every(b => b.x === 0)).toBe(true);
    });

    test("content wider than the region reports not fitting", () => {
        const r = stack(mkCtx(), null, { items: Array.from({ length: 6 }, () => ({ w: 80, h: 20 })), box: region, gap: 10 });
        expect(r.fits).toBe(false);
    });

    test("ids come back so a caller can match boxes to its data", () => {
        const r = stack(mkCtx(), null, { items: [{ id: "left", w: 20, h: 10 }, { id: "right", w: 20, h: 10 }], box: region, justify: "space-between" });
        expect(r.boxes.map(b => b.id)).toEqual(["left", "right"]);
    });

    test("boxes carry both spellings of their size", () => {
        const r = stack(mkCtx(), null, { items: [{ w: 20, h: 10 }], box: region });
        expect(r.boxes[0]!.width).toBe(20);
        expect(r.boxes[0]!.height).toBe(10);
    });
});

describe("svg.theme", () => {
    test("a tone hands out fill, stroke and readable text together", () => {
        const t = theme(mkCtx(), null, {});
        const tone = t.tone("accent");
        expect(Object.keys(tone).sort()).toEqual(["fill", "stroke", "text"]);
        expect(tone.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    test("a tone spreads straight onto a rect, because its keys are attributes", () => {
        const t = theme(mkCtx(), null, {});
        const node = element(mkCtx(), null, { tag: "rect", props: { x: 0, y: 0, width: 10, height: 10, ...t.tone("solid") } });
        expect(node.markup).toContain(`fill="${t.tone("solid").fill}"`);
        expect(node.markup).toContain(`stroke="${t.tone("solid").stroke}"`);
    });

    test("space is the 8-point scale, with halves allowed", () => {
        const t = theme(mkCtx(), null, {});
        expect([t.space(1), t.space(2), t.space(0.5)]).toEqual([8, 16, 4]);
    });

    test("a custom unit rescales the whole drawing's spacing", () => {
        const t = theme(mkCtx(), null, { unit: 10 });
        expect(t.space(3)).toBe(30);
    });

    test("the dark palette inverts ink against the background", () => {
        const light = theme(mkCtx(), null, { name: "paper" });
        const dark = theme(mkCtx(), null, { name: "slate" });
        expect(dark.ink).not.toBe(light.ink);
        expect(dark.tone("neutral").text).toBe(dark.ink);
    });

    test("overriding one colour of a tone keeps the other two", () => {
        const t = theme(mkCtx(), null, { tones: { accent: { fill: "#123456" } } });
        expect(t.tone("accent").fill).toBe("#123456");
        expect(t.tone("accent").stroke).toBe(theme(mkCtx(), null, {}).tone("accent").stroke);
    });

    test("a new tone can be declared, not just patched", () => {
        const t = theme(mkCtx(), null, { tones: { brand: { fill: "#fff0f0", stroke: "#ffd0d0", text: "#330000" } } });
        expect(t.tone("brand").text).toBe("#330000");
        expect(t.toneNames).toContain("brand");
    });

    test("text colours override without restating the tones", () => {
        const t = theme(mkCtx(), null, { colors: { ink: "#000000" } });
        expect(t.ink).toBe("#000000");
        expect(t.note).toBe(theme(mkCtx(), null, {}).note);
    });

    test("an unknown tone lists the ones that exist", () => {
        expect(() => theme(mkCtx(), null, {}).tone("nope")).toThrow(/have: accent/);
    });

    test("every tone keeps its text distinct from its fill, or a card is unreadable", () => {
        for (const name of ["paper", "slate", "warm"] as const) {
            const t = theme(mkCtx(), null, { name });
            for (const tone of t.toneNames) {
                expect(t.tone(tone).text).not.toBe(t.tone(tone).fill);
            }
        }
    });
});

describe("svg.theme figjam", () => {
    test("the figjam palette is Figma's published sticky colours, verbatim", () => {
        const t = theme(mkCtx(), null, { name: "figjam" });
        expect(t.tone("accent").fill).toBe("#A8DAFF");
        expect(t.tone("good").fill).toBe("#B3EFBD");
        expect(t.tone("warn").fill).toBe("#FFE299");
        expect(t.tone("bad").fill).toBe("#FFB8A8");
    });

    test("text is Charcoal, which their guide names as the default", () => {
        const t = theme(mkCtx(), null, { name: "figjam" });
        expect(t.ink).toBe("#1E1E1E");
        // Their guide warns off mid-greys for body text on a near-white canvas.
        expect(["#757575", "#B3B3B3", "#D9D9D9"]).not.toContain(t.note);
    });

    test("saturated tones carry white text, light ones carry charcoal", () => {
        const t = theme(mkCtx(), null, { name: "figjam" });
        expect(t.tone("solid").text).toBe("#FFFFFF");
        expect(t.tone("violet").text).toBe("#FFFFFF");
        expect(t.tone("accent").text).toBe("#1E1E1E");
    });

    test("the whiteboard colours are there as tones, not as a second vocabulary", () => {
        const t = theme(mkCtx(), null, { name: "figjam" });
        for (const name of ["teal", "violet", "pink", "orange", "black"]) {
            expect(t.toneNames).toContain(name);
            expect(t.tone(name).stroke).toMatch(/^#[0-9A-F]{6}$/i);
        }
    });

    test("every palette names its font and type scale", () => {
        for (const name of ["paper", "slate", "warm", "figjam"] as const) {
            const t = theme(mkCtx(), null, { name });
            expect(t.font).toContain("Inter");
            expect(t.size.title).toBeGreaterThan(t.size.label);
            expect(t.size.note).toBeGreaterThan(t.size.tick);
        }
    });

    test("the font stack can be overridden for one drawing", () => {
        const t = theme(mkCtx(), null, { font: "ui-monospace, monospace" });
        expect(t.font).toBe("ui-monospace, monospace");
    });
});
