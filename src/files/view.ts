import { basename, dirname, extname } from "node:path";

/**
 * Renders the Files viewer for one file or directory as an HTML fragment: breadcrumbs, a directory listing,
 * or a file with its Preview / Code / Edit tabs (Markdown and HTML preview, images, video, audio, PDF,
 * highlighted source, the CodeMirror editor with autosave).
 *
 * Use to show a file inside another page without framing the Files page: the canvas file tab draws this
 * directly, the /files page wraps it in the app layout. Links point at the canonical Files URLs
 * (/files/absolute/…, /files/remote/<host>/…, or /files/embed/… with embed), with `?tab=` for file tabs;
 * a host page may intercept them. The caller checks the path exists; the fragment fills its parent height.
 * @param opts.path Absolute (or workspace-relative, local only) path of the file or directory.
 * @param opts.host SSH host alias the path lives on; omitted means local.
 * @param opts.isDir Whether the path is a directory.
 * @param opts.tab File tab to show; empty picks Preview for Markdown/HTML/media and Code otherwise.
 * @param opts.wide Use the full width with small padding instead of a centred column. @default false
 * @param opts.embed Link to the /files/embed/… addresses used by framed viewers. @default false
 * @param opts.assetsBase Resolve relative Markdown links and images against the file's directory, for showing inside another page. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Absolute (or workspace-relative, local only) path of the file or directory. */
        path: string;
        /** SSH host alias the path lives on; omitted means local. */
        host?: string;
        /** Whether the path is a directory. */
        isDir: boolean;
        /** File tab to show; empty picks Preview for Markdown/HTML/media and Code otherwise. */
        tab?: "" | "preview" | "code" | "edit";
        /** Use the full width with small padding instead of a centred column. @default false */
        wide?: boolean;
        /** Link to the /files/embed/… addresses used by framed viewers. @default false */
        embed?: boolean;
        /** Resolve relative Markdown links and images against the file's directory, for showing inside another page. @default false */
        assetsBase?: boolean;
    },
): Promise<{ title: string; html: string }> {
    if (await ctx.fns.files.isPrivateResult({ path: opts.path, host: opts.host })) return { title: "not found", html: "<p>not found</p>" };
    if (opts.isDir) return renderDir(ctx, opts.path, !!opts.wide, !!opts.embed, opts.host);
    return renderFile(ctx, opts.path, opts.tab ?? "", !!opts.wide, !!opts.embed, opts.host, !!opts.assetsBase);
}

async function renderDir(ctx: Context, path: string, wide = false, embedded = false, host?: string) {
    const listed = await ctx.fns.files.list({ path, host });
    const visible = await Promise.all(listed.map(async entry => ({ entry, denied: await ctx.fns.files.isPrivateResult({ path: path ? `${path.replace(/\/$/, "")}/${entry.name}` : entry.name, host }) })));
    const entries = visible.filter(item => !item.denied).map(item => item.entry);
    const crumbs = await breadcrumbs(ctx, path, embedded, host);
    const w = ctx.fns.w;
    const rows = (await Promise.all(entries.map(async e => {
        // Joining an absolute parent must not double the slash: "/" + "Users".
        const full = path ? `${path.replace(/\/$/, "")}/${e.name}` : e.name;
        return w.listRow({ label: e.name, icon: e.isDir ? "folder-simple" : fileIcon(e.name), hint: e.isDir ? "Directory" : fileKind(e.name), action: { href: await browserHref(ctx, full, embedded, host) } });
    }))).join("");
    const card = w.card({
        title: path ? basename(path) || path : "workspace",
        icon: "folder-open",
        actions: w.box({ body: `${entries.length} item${entries.length === 1 ? "" : "s"}`, mix: { text: "small", ink: "faint" }, tag: "span" }),
        flush: true,
        body: w.list({ body: rows, label: "Files", empty: "This directory is empty." }),
    });
    const body = frame(crumbs + card, wide);
    return { title: path || "files", html: body };
}

async function renderFile(ctx: Context, path: string, tabParam: string, wide = false, embedded = false, host?: string, assetsBase = false) {
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
    const content = isMedia ? "" : await ctx.fns.files.read({ path, host });

    const w = ctx.fns.w;
    const fileUrl = await browserHref(ctx, path, embedded, host);
    const modes: Array<{ label: string; value: string; action: types.w.Action }> = [];
    if (isMd || isHtml || isMedia) modes.push({ label: "Preview", value: "preview", action: { href: `${fileUrl}?tab=preview` } });
    if (!isMedia) {
        modes.push({ label: "Code", value: "code", action: { href: `${fileUrl}?tab=code` } });
        modes.push({ label: "Edit", value: "edit", action: { href: `${fileUrl}?tab=edit` } });
    }

    let contentEl = "";
    const rawUrl = fileUrl;
    // Media and framed previews fill the card; text views scroll inside it.
    if (tab === "preview" && isImage) {
        contentEl = `<div data-file-media="image"><img src="${rawUrl}" alt="${esc(name)}" loading="eager"></div>`;
    } else if (tab === "preview" && isVideo) {
        contentEl = `<div data-file-media="video"><video src="${rawUrl}" controls preload="metadata"></video></div>`;
    } else if (tab === "preview" && isAudio) {
        contentEl = `<div data-file-media="audio">${w.empty({ icon: "waveform", title: name })}<audio src="${rawUrl}" controls preload="metadata"></audio></div>`;
    } else if (tab === "preview" && isPdf) {
        // ?raw=1: a frame is a navigation (Sec-Fetch-Dest: iframe), so without it the Files page would frame itself.
        contentEl = `<iframe data-file-frame src="${rawUrl}?raw=1" title="${esc(name)}"></iframe>`;
    } else if (tab === "preview" && isMd) {
        let html = await w.markdown({ source: content, baseDir: assetsBase && !host ? dirname(path) : undefined });
        // Shown inside another page (the canvas), relative images would resolve against that page's URL.
        if (assetsBase) {
            const dirUrl = (await ctx.fns.files.browserUrl({ path: dirname(path), host })).replace(/\/$/, "");
            html = html.replace(/(<(?:img|source|video|audio)\b[^>]*?\bsrc=")([^"]*)"/gi, (full, head, src) =>
                !src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("/") || src.startsWith("#") ? full : `${head}${dirUrl}/${src.replace(/^\.\//, "")}"`);
        }
        contentEl = `<div data-file-prose>${html}</div>`;
    } else if (tab === "preview" && isHtml) {
        contentEl = `<iframe data-file-frame srcdoc="${esc(content)}" sandbox="allow-scripts"></iframe>`;
    } else if (tab === "edit") {
        // The editor's bootstrap rides INSIDE main, not in headExtra: an htmx
        // request gets the fragment only, and the whole <head> is thrown away
        // with it. Reaching this page through the rail (a swap into #main)
        // therefore produced an empty editor pane and no way to notice why.
        // htmx re-inserts <script> nodes it finds in swapped content and keeps
        // their order, so the config and the loader run here exactly as they
        // did from the head on a cold page load.
        contentEl = `<div id="cm-editor" data-file-editor></div>
<script>window.__editor = ${scriptJson({
            saveUrl: `/files?path=${encodeURIComponent(path)}${host ? `&host=${encodeURIComponent(host)}` : ""}`,
            content,
            lang: cmLang,
        })};</script>
<script src="/files/editor.js"></script>`;
    } else {
        contentEl = `<div data-file-code>${await w.code({ code: content, lang: shikiLang, lineNumbers: true })}</div>`;
    }

    const crumbs = await breadcrumbs(ctx, path, embedded, host);
    const meta = isMedia ? ext.toUpperCase() : `${content.length} chars · ${content.split("\n").length} lines`;
    // The editor script fills #save-status and #vim-status and reads #vim-toggle.
    const tools = w.segmented({ items: modes, value: tab, name: "file-tab" })
        + `<span id="save-status" data-file-status hidden></span>`
        + (tab === "edit" ? w.switch({ name: "vim", label: "vim", id: "vim-toggle" }) : "")
        + `<span data-file-meta>${w.box({ body: esc(meta), mix: { text: "small", ink: "faint" }, tag: "span" })}</span>`;
    const head = w.paneHeader({ title: name, lead: w.icon({ name: fileIcon(name), size: 16 }), actions: tools });
    const vim = tab === "edit" ? `<div id="vim-status" data-file-vim hidden></div>` : "";
    const body = frame(crumbs + `<div data-file-card>${head}${vim}${contentEl}</div>`, wide);

    return { title: path, html: body };
}

// Breadcrumbs for a path that may be RELATIVE to the workspace or ABSOLUTE.
// An absolute path splits into a leading empty segment ("/a/b" -> ["", "a", "b"]),
// which used to render as a link with no label; and every crumb below it has to
// keep the leading slash, or the second crumb would point at a relative path
// resolved against a different base. The rail links a workdir by its absolute
// path, so this is the normal case now, not a corner one.
async function breadcrumbs(ctx: Context, path: string, embedded = false, host?: string): Promise<string> {
    const absolute = path.startsWith("/");
    const parts = path.split("/").filter(Boolean);
    const rootPath = absolute ? "/" : "";
    const items: Array<{ label: string; href?: string }> = [{ label: `${host ? `${host}:` : ""}${absolute ? "/" : "workspace"}`, href: await browserHref(ctx, rootPath, embedded, host) }];
    for (let i = 0; i < parts.length; i++) {
        const sub = (absolute ? "/" : "") + parts.slice(0, i + 1).join("/");
        items.push({ label: parts[i]!, href: await browserHref(ctx, sub, embedded, host) });
    }
    // Plain links: the Files page and a canvas tab both follow them (a page load, or canvas.navigate).
    return ctx.fns.w.crumbs({ items, plain: true });
}

// The page column: a centred GitHub-width column, or edge to edge when shown in a narrow pane (wide).
function frame(inner: string, wide: boolean): string {
    return `<div data-file-page${wide ? " data-wide" : ""}><div data-file-column>${inner}</div></div>`;
}

async function browserHref(ctx: Context, path: string, embedded: boolean, host?: string): Promise<string> {
    const url = await ctx.fns.files.browserUrl({ path, host });
    // Embed mode lives in the path prefix, so relative links and ?tab= stay inside it.
    return embedded ? url.replace("/files/absolute/", "/files/embed/").replace("/files/remote/", "/files/remote/embed/") : url;
}


function fileIcon(name: string): string {
    const ext = extname(name).slice(1).toLowerCase();
    if (IMAGE_EXT.has(ext)) return "image";
    if (VIDEO_EXT.has(ext)) return "video";
    if (AUDIO_EXT.has(ext)) return "music-note";
    if (ext === "pdf") return "file-pdf";
    if (["ts", "tsx", "js", "jsx", "json", "css", "html", "md", "py", "go", "rs"].includes(ext)) return "file-code";
    return "file";
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

// JSON embedded in an inline <script>: file contents are untrusted, and
// JSON.stringify leaves "</script>" and "<!--" intact, which lets a file close
// the element and run its own markup. Escaping "<" (and the two line
// separators JavaScript treats as newlines) keeps the value inert.
function scriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

