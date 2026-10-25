// Write a route file for a url — the url is the input, because the url is the
// thing anybody actually has in mind.
//
//   ctx.fns.procs.dev.route({ url: "/ehr/patient/:id/cardio/summary" })
//   ctx.fns.procs.dev.route({ url: "/ehr/patient/:id/cardio/summary", method: "POST" })
//
// The path grammar is easy to read and easy to get wrong from memory: a folder
// per segment, `:id` written as `$id`, and the method in the file's own name —
// so `/ehr/patient/:id/cardio/summary` is
// `src/ehr/patient/$id/cardio/summary/$route__GET.ts`. Getting it wrong produces
// no error at all: the file is simply a page at an address nobody asked for,
// which is the worst kind of mistake this framework can make.
//
// It refuses an address that already answers. A route the host itself serves is
// not yours to replace, and finding that out at boot (where `$loader_route`
// refuses it) is later than finding it out here.
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Perform route for the dev subsystem.
 * @param opts.url The target URL.
 * @param opts.method The HTTP method.
 * @param opts.title The display title.
 */
export default async function (ctx: Context, _session: Session | null, opts: { url: string; method?: string; title?: string }) {
    const method = (opts.method ?? "GET").toUpperCase();
    const url = (opts.url ?? "").trim();
    if (!url.startsWith("/")) throw new Error(`url must start with "/" — got ${JSON.stringify(opts.url)}`);
    if (url.includes("?")) throw new Error("a url with a query is one address — the query is read inside the handler, not written into the path");

    const segments = url.split("/").filter(Boolean);
    if (!segments.length) throw new Error("the root route is the app's own `src/$route__GET.ts` — write that one by hand");
    for (const segment of segments) {
        if (!/^[:$]?[A-Za-z0-9_.-]+$/.test(segment)) throw new Error(`"${segment}" is not a path segment — letters, digits, dash, and \`:name\` for a parameter`);
    }

    const taken = ctx.fns.procs.http.match({ method, pathname: url.replace(/:([A-Za-z0-9_]+)/g, "x") });
    if (taken) throw new Error(`${method} ${url} already answers — pick another address, or edit the file that serves it (procs.dev.where)`);

    const dir = segments.map(s => s.startsWith(":") ? "$" + s.slice(1) : s).join("/");
    const file = `src/${dir}/$route__${method}.ts`;
    const workdir = ctx.fns.procs.project.workdir({});
    if (await Bun.file(`${workdir}/${file}`).exists()) throw new Error(`${file} already exists`);

    await mkdir(dirname(`${workdir}/${file}`), { recursive: true });
    await Bun.write(`${workdir}/${file}`, method === "GET" ? page(url, opts.title ?? title(segments)) : post(url));
    await ctx.fns.procs.modules.reload({});
    return { url, method, file };
}

const title = (segments: string[]) => (segments[segments.length - 1] ?? "page").replace(/[-_]/g, " ").replace(/^./, c => c.toUpperCase());

function page(url: string, heading: string): string {
    return `// GET ${url} — the folders are the path, and this file is that page.
// The host whose first segment this is (\`/ehr\`, \`/portal\`) draws its own rail,
// badge and breadcrumb around whatever is returned here, so write the page and
// nothing else. Links belong to this same address: build them from it.
export default async function (ctx: Context, session: Session, opts: { req: Request; params: Record<string, string> }) {
    return {
        title: ${JSON.stringify(heading)},
        main: ctx.fns.w.page({
            page: ${JSON.stringify(heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"))},
            title: ${JSON.stringify(heading)},
            body: ctx.fns.w.empty({ title: "Nothing here yet", icon: "tray" }),
        }),
    };
}
`;
}

function post(url: string): string {
    return `// POST ${url} — answer with the fragment you changed, not with a page.
// A submit that swaps itself in place is self-contained: it behaves the same
// standalone and inside a host's shell. When it must navigate instead, answer
// with an \`hx-location\` naming THIS address — the one the reader is on.
export default async function (ctx: Context, session: Session, opts: { req: Request; params: Record<string, string> }) {
    const form = await opts.req.formData();
    return new Response(ctx.fns.w.toast({ level: "success", message: "Saved." }), {
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}
`;
}
