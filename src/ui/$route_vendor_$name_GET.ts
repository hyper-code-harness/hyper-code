// GET /ui/vendor/:name — third-party front-end assets, served from OUR origin.
//
// They used to be loaded straight from cdn.tailwindcss.com and unpkg. A
// stylesheet in <head> is render-blocking, so whenever one of those hosts was
// slow the page simply stopped — which is exactly the periodic freeze that was
// so hard to pin on anything of ours. A dependency you cannot see in a profile
// and cannot fix at 3am does not belong on the critical path.
//
// First request fetches and caches under .runtime/vendor; every later one is a
// local file. Deleting the folder is how you refresh a pin.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCES: Record<string, { url: string; type: string }> = {
    "tailwind.js": { url: "https://cdn.tailwindcss.com/3.4.16?plugins=typography", type: "text/javascript" },
    "phosphor.css": { url: "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css", type: "text/css" },
    "phosphor.woff2": { url: "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/Phosphor.woff2", type: "font/woff2" },
    "phosphor.ttf": { url: "https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/Phosphor.ttf", type: "font/ttf" },
};

/** Handles the HTTP route vendor :name GET endpoint. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Route parameters captured from the request path. */ params: Record<string, string> }) {
    const name = opts.params.name!;
    const source = SOURCES[name];
    if (!source) return new Response("unknown asset", { status: 404 });

    const dir = resolve(await ctx.fns.procs.project.runtimeDir({}), "vendor");
    const path = resolve(dir, name);
    const file = Bun.file(path);

    let body: ArrayBuffer | string;
    if (await file.exists()) {
        body = await file.arrayBuffer();
    } else {
        const res = await fetch(source.url);
        if (!res.ok) return new Response(`upstream ${res.status}`, { status: 502 });
        body = await res.arrayBuffer();
        await mkdir(dir, { recursive: true });
        await Bun.write(path, body);
        // The stylesheet points at the font by relative name; ours lives beside
        // it under the same route, so the reference keeps working.
        if (name === "phosphor.css") {
            const css = new TextDecoder().decode(body as ArrayBuffer)
                .replaceAll("./Phosphor.woff2", "phosphor.woff2")
                .replaceAll("./Phosphor.ttf", "phosphor.ttf");
            await Bun.write(path, css);
            body = css;
        }
    }

    return new Response(body as any, {
        headers: {
            "content-type": source.type,
            // Pinned by version in the URL upstream, so it can be cached hard.
            "cache-control": "public, max-age=604800, immutable",
        },
    });
}
