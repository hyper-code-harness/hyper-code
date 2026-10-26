/**
 * Returns the compiled app and w widget stylesheets as text, for inlining into sandboxed canvas frames
 *
 * A sandboxed canvas frame (an html tab, opaque origin, CSP without 'self') cannot link /procs/styles/app.css: it has no cookie and no own origin. This returns the same compiled sheets the Hyper page uses — the Tailwind app sheet (theme tokens for light and dark, preflight, components, utilities, prose) and the w widget sheet (--w-* tokens and widget looks) — so the frame's document can carry it inline in a <style>. Cached per compiled file and its modification time; a rebuild of the sheet is picked up on the next call. Use from canvas.htmlFrame or any other frame document that must look like Hyper without network access.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<string> {
    // The app sheet (theme tokens, Tailwind, prose) and the w widget sheet (--w-* tokens, widget looks): a frame
    // page and the .rpc-view defaults it gets are drawn with both, like the Hyper page.
    const sheets = ((ctx.state.procs as any).styles ?? []).filter((s: any) => String(s.href).startsWith("/procs/styles/") || s.href === "/w/w.css");
    if (!sheets.length) return "";
    const paths: string[] = await Promise.all(sheets.map((s: any) => ctx.fns.procs.styles.build({ abs: s.abs, key: s.key })));
    const stamps = await Promise.all(paths.map(p => Bun.file(p).stat().then(s => p + ":" + s.mtimeMs, () => p + ":0")));
    const stamp = stamps.join("|");
    const cache = ((ctx.state as any).canvas ??= {}).frameCss as { stamp: string; css: string } | undefined;
    if (cache?.stamp === stamp) return cache.css;
    // Inlined into a <style>: no "</" may close it early.
    const css = (await Promise.all(paths.map(p => Bun.file(p).text()))).join("\n").replace(/<\//g, "<\\/");
    (ctx.state as any).canvas.frameCss = { stamp, css };
    return css;
}
