import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

// GET /files?path=... — directory listing OR file view (Preview/Code/Edit).
/** Handles the corresponding HTTP route. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming HTTP request. */ req: Request; /** Route parameters. */ params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const path = url.searchParams.get("path") ?? "";
    const tab = url.searchParams.get("tab") ?? "";
    const embedded = url.searchParams.get("embed") === "1";
    const wide = url.searchParams.get("wide") === "1";
    const abs = ctx.fns.files.resolveSafe({ path });
    const st = await stat(abs).catch(() => null);
    if (!st) {
        return {
            status: 404,
            title: path || "files",
            main: page(`<div class="p-6 text-error">not found: <code>${esc(path)}</code></div>`),
        };
    }

    if (st.isDirectory()) return renderDir(ctx, path, wide, embedded);

    // User is already navigating here — add to tabs but don't broadcast
    // (self-echo would cancel the in-flight nav and re-trigger it).
    ctx.fns.files.open({ path, broadcast: false });
    return renderFile(ctx, path, tab, wide, embedded);
}

async function renderDir(ctx: Context, path: string, wide = false, embedded = false) {
    const entries = await ctx.fns.files.list({ path });
    const crumbs = await breadcrumbs(ctx, path, embedded);
    const rows = (await Promise.all(entries.map(async (e, index) => {
        // Joining an absolute parent must not double the slash: "/" + "Users".
        const full = path ? `${path.replace(/\/$/, "")}/${e.name}` : e.name;
        const icon = e.isDir ? "ph-folder text-subtle" : fileIcon(e.name);
        const href = await browserHref(ctx, full, embedded);
        return `<a href="${href}" class="group grid min-h-9 grid-cols-[minmax(0,1fr)_7rem] items-center border-t border-ui-border px-4 text-sm hover:bg-base-200 ${index === 0 ? "border-t-0" : ""}">
<span class="flex min-w-0 items-center gap-3"><i class="ph ${icon} text-base"></i><span class="truncate text-base-content group-hover:text-primary group-hover:underline">${esc(e.name)}</span></span>
<span class="text-right text-xs text-faint">${e.isDir ? "Directory" : fileKind(e.name)}</span>
</a>`;
    }))).join("");
    const body = `<div class="dot-grid-surface flex-1 overflow-y-auto ${wide ? "p-2" : "px-5 py-5"}">
<div class="mx-auto w-full ${wide ? "max-w-none" : "max-w-5xl"}">
  <div class="mb-4 flex min-w-0 items-center gap-2 text-sm text-muted">${crumbs}</div>
  <div class="overflow-hidden rounded-md border border-ui-border bg-base-100 shadow-sm">
    <div class="flex h-10 items-center gap-2 border-b border-ui-border bg-base-200 px-4">
      <i class="ph ph-folder-open text-subtle"></i><span class="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">${esc(path ? basename(path) || path : "workspace")}</span>
      <span class="text-xs text-subtle">${entries.length} item${entries.length === 1 ? "" : "s"}</span>
    </div>
    <div>${rows || '<div class="px-4 py-10 text-center text-sm text-subtle">This directory is empty.</div>'}</div>
  </div>
</div>
</div>`;
    return { title: path || "files", main: page(body) };
}

async function renderFile(ctx: Context, path: string, tabParam: string, wide = false, embedded = false) {
    const name = basename(path);
    const ext = extname(name).slice(1).toLowerCase();
    const isMd = ext === "md" || ext === "markdown";
    const isHtml = ext === "html" || ext === "htm";
    const isImage = IMAGE_EXT.has(ext);
    const isVideo = VIDEO_EXT.has(ext);
    const isAudio = AUDIO_EXT.has(ext);
    const isPdf = ext === "pdf";
    const isMedia = isImage || isVideo || isAudio || isPdf;
    const tab = isMedia ? "preview" : (tabParam || (isMd || isHtml ? "preview" : "code"));
    const shikiLang = SHIKI_EXT[ext] ?? "text";
    const cmLang = CM_EXT[ext] ?? null;
    // Binary media must never pass through files.read(), which decodes as UTF-8.
    const content = isMedia ? "" : await ctx.fns.files.read({ path });

    const tabCls = (id: string) => id === tab
        ? "border-b-2 border-warning px-3 py-2 text-sm font-semibold text-base-content"
        : "border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:border-ui-border hover:text-base-content";
    const fileUrl = await browserHref(ctx, path, embedded);
    const tabLink = (id: string, label: string) =>
        `<a href="${fileUrl}?tab=${id}" class="${tabCls(id)}">${label}</a>`;

    const tabs: string[] = [];
    if (isMd || isHtml || isMedia) tabs.push(tabLink("preview", "Preview"));
    if (!isMedia) {
        tabs.push(tabLink("code", "Code"));
        tabs.push(tabLink("edit", "Edit"));
    }

    let contentEl = "";
    const rawUrl = fileUrl;
    if (tab === "preview" && isImage) {
        contentEl = `<div class="flex flex-1 items-center justify-center overflow-auto bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%),linear-gradient(-45deg,#e5e7eb_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e5e7eb_75%),linear-gradient(-45deg,transparent_75%,#e5e7eb_75%)] bg-[length:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] p-8"><img src="${rawUrl}" alt="${esc(name)}" class="max-h-full max-w-full object-contain shadow-lg" loading="eager"></div>`;
    } else if (tab === "preview" && isVideo) {
        contentEl = `<div class="flex flex-1 items-center justify-center overflow-auto bg-black p-6"><video src="${rawUrl}" class="max-h-full max-w-full" controls preload="metadata"></video></div>`;
    } else if (tab === "preview" && isAudio) {
        contentEl = `<div class="flex flex-1 flex-col items-center justify-center gap-5 bg-base-200 p-8"><i class="ph ph-waveform text-6xl text-faint"></i><div class="text-sm font-medium text-muted">${esc(name)}</div><audio src="${rawUrl}" class="w-full max-w-xl" controls preload="metadata"></audio></div>`;
    } else if (tab === "preview" && isPdf) {
        contentEl = `<iframe src="${rawUrl}" title="${esc(name)}" class="flex-1 w-full border-0 bg-base-200"></iframe>`;
    } else if (tab === "preview" && isMd) {
        const html = await ctx.fns.markdown.render({ source: content });
        contentEl = `<div class="flex-1 overflow-auto p-6"><div class="prose prose-sm max-w-none">${html}</div></div>`;
    } else if (tab === "preview" && isHtml) {
        contentEl = `<iframe srcdoc="${esc(content)}" class="flex-1 w-full border-0" sandbox="allow-scripts"></iframe>`;
    } else if (tab === "edit") {
        // The editor's bootstrap rides INSIDE main, not in headExtra: an htmx
        // request gets the fragment only, and the whole <head> is thrown away
        // with it. Reaching this page through the rail (a swap into #main)
        // therefore produced an empty editor pane and no way to notice why.
        // htmx re-inserts <script> nodes it finds in swapped content and keeps
        // their order, so the config and the loader run here exactly as they
        // did from the head on a cold page load.
        contentEl = `<div id="cm-editor" class="flex-1 overflow-hidden"></div>
<script>window.__editor = ${JSON.stringify({
            saveUrl: `/files?path=${encodeURIComponent(path)}`,
            content,
            lang: cmLang,
        })};</script>
<script src="/files/editor.js"></script>`;
    } else {
        const html = await ctx.fns.markdown.highlight({ code: content, lang: shikiLang });
        contentEl = `<div class="flex-1 overflow-auto text-xs bg-base-100 [&_pre]:m-0 [&_pre]:rounded-none [&_pre]:p-4">${html}</div>`;
    }

    const crumbs = await breadcrumbs(ctx, path, embedded);
    const body = `
<div class="dot-grid-surface flex-1 min-h-0 overflow-auto ${wide ? "p-2" : "px-5 py-5"}">
  <div class="mx-auto flex min-h-full w-full ${wide ? "max-w-none" : "max-w-5xl"} flex-col">
    <div class="mb-4 flex min-w-0 items-center gap-2 text-sm">${crumbs}</div>
    <div class="flex min-h-[32rem] flex-1 flex-col overflow-hidden rounded-md border border-ui-border bg-base-100 shadow-sm">
      <div class="shrink-0 border-b border-ui-border bg-base-200 px-4 pt-3">
        <div class="flex min-w-0 items-center gap-2">
          <i class="ph ${fileIcon(name)} text-subtle"></i>
          <span class="min-w-0 flex-1 truncate text-sm font-semibold text-base-content">${esc(name)}</span>
          <span id="save-status" class="text-xs hidden"></span>
          ${tab === "edit" ? `<label class="flex cursor-pointer items-center gap-1 text-xs text-subtle"><input type="checkbox" id="vim-toggle" class="h-3 w-3">vim</label>` : ""}
          <span class="shrink-0 text-xs text-faint">${isMedia ? ext.toUpperCase() : `${content.length} chars · ${content.split("\n").length} lines`}</span>
        </div>
        <nav class="mt-2 flex items-end gap-1">${tabs.join("")}</nav>
      </div>
      ${tab === "edit" ? `<div id="vim-status" class="hidden shrink-0 bg-base-content px-3 py-0.5 font-mono text-xs text-base-100"></div>` : ""}
      ${contentEl}
    </div>
  </div>
</div>`;

    return { title: path, main: page(body) };
}

function page(body: string): string {
    return `<div class="flex-1 flex flex-col overflow-hidden">${body}</div>`;
}

// Breadcrumbs for a path that may be RELATIVE to the workspace or ABSOLUTE.
// An absolute path splits into a leading empty segment ("/a/b" -> ["", "a", "b"]),
// which used to render as a link with no label; and every crumb below it has to
// keep the leading slash, or the second crumb would point at a relative path
// resolved against a different base. The rail links a workdir by its absolute
// path, so this is the normal case now, not a corner one.
async function breadcrumbs(ctx: Context, path: string, embedded = false): Promise<string> {
    const absolute = path.startsWith("/");
    const parts = path.split("/").filter(Boolean);
    const rootPath = absolute ? "/" : "";
    const rootLabel = absolute ? "/" : "workspace";
    const links = [`<a href="${await browserHref(ctx, rootPath, embedded)}" class="font-semibold text-primary hover:underline">${rootLabel}</a>`];
    for (let i = 0; i < parts.length; i++) {
        const sub = (absolute ? "/" : "") + parts.slice(0, i + 1).join("/");
        links.push(`<a href="${await browserHref(ctx, sub, embedded)}" class="font-semibold text-primary hover:underline">${esc(parts[i]!)}</a>`);
    }
    return links.join(` <i class="ph ph-caret-right text-3xs text-faint"></i> `);
}

async function browserHref(ctx: Context, path: string, embedded: boolean): Promise<string> {
    const url = await ctx.fns.files.browserUrl({ path });
    return embedded ? url.replace("/files/absolute/", "/files/embed/") : url;
}


function fileIcon(name: string): string {
    const ext = extname(name).slice(1).toLowerCase();
    if (IMAGE_EXT.has(ext)) return "ph-image text-faint";
    if (VIDEO_EXT.has(ext)) return "ph-video text-faint";
    if (AUDIO_EXT.has(ext)) return "ph-music-note text-faint";
    if (ext === "pdf") return "ph-file-pdf text-faint";
    if (["ts", "tsx", "js", "jsx", "json", "css", "html", "md", "py", "go", "rs"].includes(ext)) return "ph-file-code text-faint";
    return "ph-file text-faint";
}

function fileKind(name: string): string {
    const ext = extname(name).slice(1).toLowerCase();
    return ext ? `${ext.toUpperCase()} file` : "File";
}


function esc(s: any): string {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]!));
}

const SHIKI_EXT: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
    json: "json", md: "markdown", html: "html", css: "css", sql: "sql",
    py: "python", rs: "rust", go: "go", java: "java", yaml: "yaml", yml: "yaml",
    toml: "toml", sh: "bash", bash: "bash", zsh: "bash", xml: "xml", diff: "diff",
};
const CM_EXT: Record<string, string> = {
    ts: "javascript", tsx: "javascript", js: "javascript", jsx: "javascript", mjs: "javascript",
    json: "json", md: "markdown", html: "html", css: "css", sql: "sql",
    py: "python", rs: "rust", go: "go", java: "java", yaml: "yaml", yml: "yaml",
    xml: "xml",
};


const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp", "ico"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v", "ogv"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"]);
