import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Saves a drawing from the editor: the scene JSON and its exported SVG preview. CSRF-protected via the x-csrf-token header.
 * @param opts.req Incoming HTTP request with `{ scene, svg }` JSON.
 * @param opts.params Route parameters: the drawing name.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */ req: Request;
    /** Route parameters: the drawing name. */ params: { name: string } }) {
    const req = opts.req;
    if (!await ctx.fns.auth.verifyCsrf({ req, token: req.headers.get("x-csrf-token") ?? "" })) return Response.json({ error: "invalid csrf token" }, { status: 403 });
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "drawing too large" }, { status: 413 });
    let f;
    try { f = await ctx.fns.excalidraw.file({ name: opts.params.name }); }
    catch (e: any) { return Response.json({ error: e.message }, { status: 400 }); }
    const text = await req.text();
    if (text.length > MAX_BYTES) return Response.json({ error: "drawing too large" }, { status: 413 });
    let body: any;
    try { body = JSON.parse(text); } catch { return Response.json({ error: "invalid json" }, { status: 400 }); }
    const scene = body?.scene;
    if (!scene || scene.type !== "excalidraw" || !Array.isArray(scene.elements)) return Response.json({ error: "not an excalidraw scene" }, { status: 400 });
    const svg = typeof body.svg === "string" && body.svg.trimStart().startsWith("<svg") ? body.svg : null;
    await mkdir(dirname(f.scene), { recursive: true });
    await Bun.write(f.scene, JSON.stringify(scene, null, 2));
    if (svg) await Bun.write(f.svg, svg);
    return Response.json({ ok: true, name: f.name, elements: scene.elements.length, preview: Boolean(svg) });
}
