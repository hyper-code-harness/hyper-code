import { stat } from "node:fs/promises";

// GET /files?path=... — directory listing OR file view (Preview/Code/Edit).
/** Handles the corresponding HTTP route. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming HTTP request. */ req: Request; /** Route parameters. */ params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const path = url.searchParams.get("path") ?? "";
    const tab = url.searchParams.get("tab") ?? "";
    const embedded = url.searchParams.get("embed") === "1";
    const wide = url.searchParams.get("wide") === "1";
    // ?host=<alias> browses a directory on an SSH host (remote workspace).
    const host = url.searchParams.get("host") || undefined;
    if (host && !(await ctx.fns.remote.servers({})).some(s => s.name === host)) {
        return { status: 400, title: "files", main: page(`<div class="p-6 text-error">unknown host: <code>${esc(host)}</code></div>`) };
    }
    // Remote links must be absolute: a relative or ~ path is resolved on the host
    // once and the page is served for that absolute path.
    if (host && !path.startsWith("/")) {
        const abs = await ctx.fns.workspace.normalize({ dir: path || "~", host }).catch(() => null)
            ?? await resolveRemoteFile(ctx, host, path);
        if (abs) {
            const target = (await ctx.fns.files.browserUrl({ path: abs, host })).replace("/files/remote/", embedded ? "/files/remote/embed/" : "/files/remote/");
            const tab = url.searchParams.get("tab");
            return new Response(null, { status: 303, headers: { location: target + (tab ? `?tab=${encodeURIComponent(tab)}` : "") } });
        }
    }
    if (await ctx.fns.files.isPrivateResult({ path, host })) return new Response("not found", { status: 404 });
    const st = host
        ? await ctx.fns.files.stat({ path, host }).then(s => s && { isDirectory: () => s.isDir }).catch(() => null)
        : await stat(ctx.fns.files.resolveSafe({ path })).catch(() => null);
    if (!st) {
        return {
            status: 404,
            title: path || "files",
            main: page(`<div class="p-6 text-error">not found: <code>${esc(path)}</code></div>`),
        };
    }

    const tabName = (["preview", "code", "edit"].includes(tab) ? tab : "") as "" | "preview" | "code" | "edit";
    if (st.isDirectory()) {
        const view = await ctx.fns.files.view({ path, host, isDir: true, wide, embed: embedded });
        return { title: view.title, main: page(view.html) };
    }

    // User is already navigating here — add to tabs but don't broadcast
    // (self-echo would cancel the in-flight nav and re-trigger it).
    if (!host) ctx.fns.files.open({ path, broadcast: false });
    const view = await ctx.fns.files.view({ path, host, isDir: false, tab: tabName, wide, embed: embedded });
    return { title: view.title, main: page(view.html) };
}

function page(body: string): string {
    return `<div class="flex-1 flex flex-col overflow-hidden">${body}</div>`;
}

function esc(s: any): string {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

// Absolute path of a (non-directory) file on an SSH host, or null.
async function resolveRemoteFile(ctx: Context, host: string, path: string): Promise<string | null> {
    const q = ctx.fns.remote.quote({ value: path, path: true });
    const r = await ctx.fns.remote.exec({ host, command: 'f=' + q + '; [ -e "$f" ] || exit 2; d=$(cd -- "$(dirname -- "$f")" && pwd -P) || exit 2; printf "%s/%s" "$d" "$(basename -- "$f")"', timeout: 30 });
    return r.exitCode === 0 && r.stdout.startsWith("/") ? r.stdout : null;
}
