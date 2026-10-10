/**
 * Lay out a simple graph with native HOLA orthogonal routes.
 *
 * Use for human-like orthogonal layouts; disconnected components are packed horizontally. Requires ~/.hyper/deps/svg/hola-graph-0.1.5 Python venv with hola-graph==0.1.5: MIT wrapper, LGPL Adaptagrams. Native subprocess is killed on timeout; no auto-install or fallback.
 * @param opts.nodes Unique node IDs, positive finite dimensions, optional initial top-left coordinates; missing coordinates receive deterministic grid seeds.
 * @param opts.edges Unique edge IDs referencing existing endpoints; self-loops and parallel undirected edges are unsupported.
 * @param opts.timeoutMs Maximum Python subprocess duration in milliseconds; timeout kills and reaps the process and removes temporary files. @default 30000 @minimum 1 @maximum 120000
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Unique node IDs, positive finite dimensions, optional initial top-left coordinates; missing coordinates receive deterministic grid seeds. */
        nodes: Array<{id:string;w:number;h:number;x?:number;y?:number}>;
        /** Unique edge IDs referencing existing endpoints; self-loops and parallel undirected edges are unsupported. */
        edges: Array<{id:string;from:string;to:string}>;
        /** Maximum Python subprocess duration in milliseconds; timeout kills and reaps the process and removes temporary files. @default 30000 @minimum 1 @maximum 120000 */
        timeoutMs?: number;
    },
): Promise<types.svg.GraphLayoutResult> {
    await ctx.fns.svg.layoutValidate({ nodes: opts.nodes, edges: opts.edges });
    const timeoutMs = opts.timeoutMs ?? 30000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error("timeoutMs must be an integer between 1 and 120000");
    const metadata: types.svg.GraphLayoutResult["metadata"] = { algorithm: "HOLA", engine: "hola-graph@0.1.5/HolaGraph.layout", routing: "orthogonal", warnings: [] };
    if (!opts.nodes.length) return await ctx.fns.svg.layoutResult({ boxes: [], routes: [], metadata });
    const { homedir, tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const { mkdtemp, rm, access } = await import("node:fs/promises");
    const { constants } = await import("node:fs");
    const python = join(homedir(), ".hyper/deps/svg/hola-graph-0.1.5/bin/python");
    try { await access(python, constants.X_OK); } catch (cause) { throw new Error("Missing HOLA dependency. Run: python3 -m venv ~/.hyper/deps/svg/hola-graph-0.1.5 && ~/.hyper/deps/svg/hola-graph-0.1.5/bin/python -m pip install hola-graph==0.1.5. Wrapper MIT; Adaptagrams LGPL-2.1-or-later.", { cause }); }
    const script = resolve(import.meta.dir, "../../scripts/hola_layout.py");
    const work = await mkdtemp(join(tmpdir(), "hyper-svg-hola-"));
    let proc: ReturnType<typeof Bun.spawn> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const input = join(work, "input.json"), output = join(work, "output.json");
      await Bun.write(input, JSON.stringify({ nodes: opts.nodes, edges: opts.edges }));
      const running = Bun.spawn([python, script, "hola", input, output], { cwd: work, stdin: "ignore", stdout: "ignore", stderr: "pipe", env: { ...process.env, PYTHONNOUSERSITE: "1" } });
      proc = running;
      timer = setTimeout(() => { timedOut = true; running.kill("SIGKILL"); }, timeoutMs);
      const [code, stderr] = await Promise.all([running.exited, new Response(running.stderr).text()]);
      if (timedOut) throw new Error("HOLA layout timed out after " + timeoutMs + "ms");
      if (code !== 0) throw new Error("HOLA native layout failed (exit " + code + "): " + stderr.slice(-4000));
      const result = await Bun.file(output).json() as { boxes: types.svg.GraphLayoutResult["boxes"]; routes: types.svg.GraphLayoutResult["routes"]; metadata: types.svg.GraphLayoutResult["metadata"] };
      return await ctx.fns.svg.layoutResult({ boxes: result.boxes, routes: result.routes, metadata: result.metadata });
    } finally {
      if (timer) clearTimeout(timer);
      if (proc && proc.exitCode === null) { proc.kill("SIGKILL"); await proc.exited; }
      await rm(work, { recursive: true, force: true });
    }
}
