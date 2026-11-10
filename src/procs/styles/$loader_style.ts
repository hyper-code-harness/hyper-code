// `<module>/$style_<name>.css` — a Tailwind input, compiled against the whole
// scan, cached, and served at the path its name spells. The framework's own
// stylesheet leads and a module's cascades over it, so the order is the layout's.
/**
 * Load loader style declarations into the runtime.
 * @param opts.entries The loader entries to register.
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: any[] }): Promise<void> {
    const routes = (ctx.state.procs.http.routes ??= {});
    const styles = (ctx.state.procs.styles ??= []);
    for (const entry of opts.entries) {
        const style = { href: entry.routePath, abs: entry.abs, key: entry.abs.replace(/[^a-zA-Z0-9]+/g, "_") };
        (routes[style.href] ??= {}).GET = async (rctx: Context, _s: Session | null, args?: { req?: Request }) => {
            // `build` decides what is cached — it keys on the wrapper it
            // generates, which names every mounted module, so a module added
            // since the last build is compiled in. Guessing a path here instead
            // is how a leftover file from an older layout shadowed every build
            // that came after it.
            const path = await rctx.fns.procs.styles.build(style);
            // Strong ETag + 304: the sheet is 200+ KB and changes only on a rebuild, so a
            // repeat visit revalidates in one round trip instead of downloading it again.
            return rctx.fns.procs.http.serveFile({ path, contentType: "text/css; charset=utf-8", req: args?.req });
        };
        styles.push(style);
        ctx.fns.procs.log.debug({ event: "load.style", msg: style.href, from: `${entry.root}/${entry.rel}` });
    }
    const framework = (s: any) => Number(s.href.startsWith("/procs/styles/"));
    styles.sort((a: any, b: any) => framework(b) - framework(a));
}
