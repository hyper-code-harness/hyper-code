/**
 * Lay out a sized graph with IMCS Compact UNIVERSAL and native orthogonal routes
 *
 * Use for compact orthogonal graph drawings with top-left node coordinates. Runs the actual IMCS UNIVERSAL engine in an isolated Bun subprocess with a hard timeout; preserves native edge routes without rerouting. Requires unmodified imcs_layoutengine 1.0.6 revision 3bbcefdc5bf25be976f4379ec986bd1db05f47bc installed under ~/.hyper/deps/svg/imcs_layoutengine, with corresponding sources and full imcs_layoutengine.COPYING (GPLv2-or-later with Classpath exception, W3C liberal and GWT-AWT GPLv2 with Classpath exception). No automatic install or download. Empty graphs need no engine. Initial coordinates are hints, not fixed constraints.
 * @param opts.nodes Unique node IDs, positive finite box sizes, and optional finite initial top-left coordinates. Up to 500 nodes.
 * @param opts.edges Unique edge IDs referencing existing node IDs. Up to 2000 edges; self-loops and parallel edges are rejected.
 * @param opts.timeoutMs Hard subprocess deadline in milliseconds; terminates the engine and throws on expiry. @default 30000 @minimum 1 @maximum 300000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique node IDs, positive finite box sizes, and optional finite initial top-left coordinates. Up to 500 nodes. */
        nodes: Array<{ id: string; w: number; h: number; x?: number; y?: number }>;
        /** Unique edge IDs referencing existing node IDs. Up to 2000 edges; self-loops and parallel edges are rejected. */
        edges: Array<{ id: string; from: string; to: string }>;
        /** Hard subprocess deadline in milliseconds; terminates the engine and throws on expiry. @default 30000 @minimum 1 @maximum 300000 */
        timeoutMs?: number;
    },
): Promise<types.svg.GraphLayoutResult> {
    await ctx.fns.svg.layoutValidate({ nodes: opts.nodes, edges: opts.edges });
    const timeoutMs = opts.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error("timeoutMs must be an integer between 1 and 300000");
    const metadata: types.svg.GraphLayoutResult["metadata"] = {
        algorithm: "Compact (UNIVERSAL)", engine: "IMCS imcs_layoutengine 1.0.6", routing: "orthogonal", warnings: [],
    };
    if (!opts.nodes.length) return await ctx.fns.svg.layoutResult({ boxes: [], routes: [], metadata });
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const library = join(homedir(), ".hyper", "deps", "svg", "imcs_layoutengine", "dist", "imcs_layoutengine.min.js");
    if (!await Bun.file(library).exists()) throw new Error("Compact dependency missing: install unmodified IMCS imcs_layoutengine 1.0.6 (revision 3bbcefdc5bf25be976f4379ec986bd1db05f47bc), with its sources and full imcs_layoutengine.COPYING notices, at ~/.hyper/deps/svg/imcs_layoutengine");
    // GWT browser shims exist only in this child; no browser globals enter the server.
    const script = `const fs = require("node:fs");
    Object.defineProperty(globalThis, "navigator", { value: { userAgent: "node" }, configurable: true });
    globalThis.window = globalThis;
    globalThis.document = { write() {}, getElementById() { return null; }, getElementsByTagName() { return []; }, location: { href: "file:///" }, readyState: "complete" };
    console.log = (...args) => console.error(...args);
    const lib = require(process.argv[1]);
    const C = lib.IMCSDiagramLayout || globalThis.IMCSDiagramLayout;
    if (typeof C !== "function") throw new Error("IMCS constructor unavailable");
    const graph = JSON.parse(fs.readFileSync(0, "utf8"));
    const layout = new C("UNIVERSAL");
    const ids = new Map();
    graph.nodes.forEach((n, i) => { ids.set(n.id, i + 1); layout.addBox(i + 1, n.x ?? (i * (n.w + 40)), n.y ?? 0, n.w, n.h); });
    graph.edges.forEach((e, i) => layout.addLine(graph.nodes.length + i + 1, ids.get(e.from), ids.get(e.to), { lineType: "ORTHOGONAL" }));
    const result = layout.arrangeFromScratch();
    const boxes = graph.nodes.map((n, i) => {
        const b = result.boxes[i + 1];
        if (!b) throw new Error("IMCS omitted box " + n.id);
        return { id: n.id, x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const routes = graph.edges.map((e, i) => {
        const points = result.lines[graph.nodes.length + i + 1];
        if (!Array.isArray(points) || points.length < 2) throw new Error("IMCS omitted route " + e.id);
        return { id: e.id, from: e.from, to: e.to, points: points.map(p => ({ x: p.x, y: p.y })) };
    });
    process.stdout.write(JSON.stringify({ boxes, routes }));`;
    const child = Bun.spawn([process.execPath, "-e", script, "--", library], {
        stdin: new TextEncoder().encode(JSON.stringify({ nodes: opts.nodes, edges: opts.edges })), stdout: "pipe", stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    let output: string;
    try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        if (timedOut) throw new Error("Compact layout timed out after " + timeoutMs + " ms");
        if (code !== 0) throw new Error("Compact engine failed (exit " + code + "): " + stderr.slice(0, 2000));
        output = stdout;
        if (stderr.trim()) metadata.warnings.push("IMCS diagnostics: " + stderr.trim().slice(0, 2000));
    } finally {
        clearTimeout(timer);
    }
    const result = JSON.parse(output) as Pick<types.svg.GraphLayoutResult, "boxes" | "routes">;
    return await ctx.fns.svg.layoutResult({ boxes: result.boxes, routes: result.routes, metadata });
}
