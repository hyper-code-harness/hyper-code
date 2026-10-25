import { createHighlighter, type Highlighter } from "shiki";

const LANGS = [
    "javascript", "typescript", "tsx", "jsx", "json", "css", "html",
    "sql", "python", "markdown", "xml", "rust", "java", "go",
    "yaml", "bash", "shell", "dockerfile", "toml", "diff",
] as const;

const ALIASES: Record<string, string> = {
    js: "javascript", ts: "typescript", sh: "bash", zsh: "bash",
    yml: "yaml", py: "python", txt: "text", plain: "text",
};

let _hl: Highlighter | null = null;

export async function getHL(): Promise<Highlighter> {
    if (!_hl) _hl = await createHighlighter({ themes: ["github-light", "github-dark", "github-light-high-contrast"], langs: [...LANGS] });
    return _hl;
}

/**
 * Highlights source code as HTML.
 * @param opts.code Code to evaluate in the browser.
 * @param opts.lang Source language identifier.
 */
export default async function (_ctx: Context, _session: Session | null, opts: { code: string; lang: string }): Promise<string> {
    const safeCode = String(opts.code ?? "");
    const safeLang = String(opts.lang ?? "text");
    const hl = await getHL();
    const normalized = ALIASES[safeLang.toLowerCase()] ?? safeLang.toLowerCase();
    if (hl.getLoadedLanguages().includes(normalized as any)) {
        try {
            return hl.codeToHtml(safeCode, {
                lang: normalized,
                // Each token carries all three colour sets as variables (--shiki-light, --shiki-dark, --shiki-contrast);
                // the page theme picks one in CSS, so changing the theme never re-highlights.
                themes: { light: "github-light", dark: "github-dark", contrast: "github-light-high-contrast" },
                defaultColor: false,
            });
        } catch { /* fall through */ }
    }
    return "<pre><code>" + safeCode.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</code></pre>";
}
