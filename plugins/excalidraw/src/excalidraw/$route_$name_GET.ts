/**
 * Opens the Excalidraw editor for one drawing; a missing drawing starts empty and is created on the first save.
 * @param opts.req Incoming HTTP request.
 * @param opts.params Route parameters: the drawing name.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Incoming HTTP request. */ req: Request;
    /** Route parameters: the drawing name. */ params: { name: string } }) {
    let f;
    try { f = await ctx.fns.excalidraw.file({ name: opts.params.name }); }
    catch (e: any) { return new Response(e.message, { status: 400 }); }
    const file = Bun.file(f.scene);
    const scene = (await file.exists()) ? await file.json() : null;
    const csrf = await ctx.fns.auth.csrfToken({ req: opts.req });
    const html = await ctx.fns.excalidraw.editorPage({ name: f.name, scene, csrf });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN" } });
}
