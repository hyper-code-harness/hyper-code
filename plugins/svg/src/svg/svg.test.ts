import { test, expect, describe } from "bun:test";
import element from "./element";
import sanitize from "./sanitize";
import render from "./render";
import tsx from "./tsx";
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
