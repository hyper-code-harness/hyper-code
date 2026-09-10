import { resolve } from "node:path";

const ENTITIES: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&#x27;": "'",
};
function decode(s: string): string {
    return s.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (m) => ENTITIES[m] ?? m);
}

function escapeHtml(value: unknown): string {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function frontmatterTable(source: string): { source: string; html: string } | null {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
    if (!match) return null;
    try {
        const data = Bun.YAML.parse(match[1]!) as Record<string, unknown>;
        if (!data || Array.isArray(data) || typeof data !== "object") return null;
        const rows = Object.entries(data).map(([key, value]) => {
            const shown = typeof value === "string" ? value : Bun.YAML.stringify(value).trim();
            return `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(shown)}</td></tr>`;
        }).join("");
        const html = rows ? `<div class="md-frontmatter"><table><tbody>${rows}</tbody></table></div>` : "";
        return { source: source.slice(match[0].length), html };
    } catch {
        return null;
    }
}


async function preprocessMermaid(ctx: Context, text: string): Promise<string> {
    const re = /```mermaid[^\n]*\n([\s\S]*?)```/g;
    const matches = [...text.matchAll(re)];
    if (matches.length === 0) return text;
    let out = text;
    for (const m of matches.reverse()) {
        const code = m[1]?.trim() ?? "";
        try {
            const html = await ctx.fns.markdown.mermaid({ source: code });
            out = out.slice(0, m.index!) + html + out.slice(m.index! + m[0]!.length);
        } catch {
            continue;
        }
    }
    return out;
}

function rewriteFileLinks(html: string, baseDir: string): string {
    return html.replace(/<a\b([^>]*?)\bhref="([^"]*)"([^>]*)>/gi, (full, before, href, after) => {
        const decoded = decode(String(href));
        let decodedUrl: string;
        try { decodedUrl = decodeURI(decoded); } catch { decodedUrl = decoded; }
        if (!decodedUrl || /^[a-z][a-z0-9+.-]*:/i.test(decodedUrl) || decodedUrl.startsWith("//") || decodedUrl.startsWith("#") || decodedUrl.startsWith("?") || decodedUrl.startsWith("/files/")) return full;
        const match = /^([^?#]*)([?#].*)?$/.exec(decodedUrl);
        const pathPart = match?.[1] ?? decodedUrl;
        const suffix = match?.[2] ?? "";
        const absolute = pathPart.startsWith("/") ? pathPart : resolve(baseDir, pathPart);
        const encoded = absolute.split("/").filter(Boolean).map(encodeURIComponent).join("/");
        return `<a${before}href="/files/absolute/${encoded}${escapeHtml(suffix)}"${after}>`;
    });
}


// GitHub-Flavored Markdown recognizes plain URLs, www-hosts and email
// addresses outside links/code. Bun's CommonMark renderer does not, so apply
// the extension to HTML text nodes after parsing; existing links and code stay untouched.
function autolinkTextNodes(html: string): string {
    const excluded = new Set(["a", "code", "pre", "script", "style"]);
    const stack: string[] = [];
    return html.split(/(<[^>]+>)/g).map(part => {
        if (part.startsWith("<")) {
            const close = /^<\s*\/\s*([a-z0-9-]+)/i.exec(part)?.[1]?.toLowerCase();
            const open = /^<\s*([a-z0-9-]+)/i.exec(part)?.[1]?.toLowerCase();
            if (close) {
                const at = stack.lastIndexOf(close);
                if (at >= 0) stack.splice(at, 1);
            } else if (open && excluded.has(open) && !/\/\s*>$/.test(part)) stack.push(open);
            return part;
        }
        return stack.length ? part : linkifyText(part);
    }).join("");
}

function linkifyText(text: string): string {
    const re = /(?:https?:\/\/|www\.)[a-z0-9](?:[a-z0-9_-]*\.)+[a-z0-9_-]+[^\s<]*|[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*\.)+[a-z]{2,}/gi;
    return text.replace(re, raw => {
        let value = raw;
        let trailing = "";
        while (/[?!.,:*_~]$/.test(value)) { trailing = value.slice(-1) + trailing; value = value.slice(0, -1); }
        while (value.endsWith(")") && (value.match(/\)/g)?.length ?? 0) > (value.match(/\(/g)?.length ?? 0)) {
            trailing = ")" + trailing;
            value = value.slice(0, -1);
        }
        const email = !/^(?:https?:\/\/|www\.)/i.test(value);
        const href = email ? `mailto:${value}` : /^www\./i.test(value) ? `http://${value}` : value;
        return `<a href="${escapeHtml(href)}">${value}</a>${trailing}`;
    });
}


/**
 * Renders Markdown to sanitized, highlighted HTML.
 * @param opts.source Markdown or Mermaid source.
 */
export default async function (ctx: Context, _session: Session | null, opts: { source: string; /** Resolve ordinary Markdown links as local files relative to this directory. */ fileBaseDir?: string }): Promise<string> {
    let source = opts.source;
    const frontmatter = frontmatterTable(source);
    if (frontmatter) source = frontmatter.source;
    if (source.includes("```mermaid")) source = await preprocessMermaid(ctx, source);
    let html = autolinkTextNodes(Bun.markdown.html(source));
    const re = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;
    const replacements: Array<{ full: string; pretty: string }> = [];
    for (const m of html.matchAll(re)) {
        const [full, lang, raw] = m;
        const pretty = await ctx.fns.markdown.highlight({ code: decode(raw!), lang: lang! });
        replacements.push({ full: full!, pretty });
    }
    for (const { full, pretty } of replacements) html = html.replace(full, pretty);
    if (opts.fileBaseDir) html = rewriteFileLinks(html, opts.fileBaseDir);
    return (frontmatter?.html ?? "") + html;
}
