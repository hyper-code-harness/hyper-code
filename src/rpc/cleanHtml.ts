// Agent-written html (memory notes, saved pages) becomes an htmx fragment inside the app page, with the
// person's cookies — so before it goes in, everything that runs or navigates on its own is removed.

const DROP = "script,iframe,frame,frameset,object,embed,base,meta,link,form,noscript,template,title";
const URL_ATTRS = new Set(["href", "src", "action", "xlink:href", "poster", "background", "srcset"]);

const unsafeUrl = (value: string) => {
    const v = value.replace(/[\u0000-\u0020]+/g, "").toLowerCase();
    return /^(javascript|vbscript|data):/.test(v) && !/^data:image\/(png|jpe?g|gif|webp);/.test(v);
};

/** Prefixes every selector with the scope; @media/@supports/@container are scoped inside, other at-rules dropped. */
function scopeCss(css: string, scope: string): string {
    const out: string[] = [];
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf("{", i);
        if (open < 0) break;
        const head = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").trim();
        let depth = 1, j = open + 1;
        while (j < css.length && depth) { if (css[j] === "{") depth++; else if (css[j] === "}") depth--; j++; }
        const body = css.slice(open + 1, j - 1);
        if (/^@(media|supports|container)\b/i.test(head)) out.push(`${head}{${scopeCss(body, scope)}}`);
        else if (head && !head.startsWith("@")) {
            const sel = head.split(",").map(s => s.trim()).filter(Boolean)
                .map(s => /^(html|body|:root|\*)$/i.test(s) ? scope : `${scope} ${s.replace(/^(html|body|:root)\s+/i, "")}`)
                .join(",");
            out.push(`${sel}{${body.replace(/expression\s*\(|javascript:|@import/gi, "x")}}`);
        }
        i = j;
    }
    return out.join("\n");
}

/**
 * Removes scripts, event handlers, htmx attributes and javascript: links from html so it can be inserted into the
 * Hyper page as a fragment.
 *
 * Use before putting html that agents or people wrote (memory notes, saved pages) into the app DOM: drops
 * script, iframe, object, embed, base, meta, link, form and template elements, on* / hx-* / srcdoc attributes and
 * javascript:/data: urls (data:image is kept). A `<style>` element is kept only with `scope`: its selectors are
 * prefixed with the scope selector (html/body/:root become the scope itself) so the page cannot restyle the app.
 * It is the boundary for agent-written content shown to its own people, not a filter for hostile third-party html.
 * @param opts.html Html document or fragment to clean.
 * @param opts.scope CSS selector the kept `<style>` rules are scoped to, e.g. `[data-view="12"]`; without it `<style>` is dropped.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Html document or fragment to clean. */
    html: string;
    /** CSS selector the kept `<style>` rules are scoped to, e.g. `[data-view="12"]`; without it `<style>` is dropped. */
    scope?: string;
}): string {
    const scope = opts.scope?.trim();
    let css = "";
    const rw = new HTMLRewriter()
        .on(DROP, { element(e) { e.remove(); } })
        .on("html,head,body", { element(e) { e.removeAndKeepContent(); } })
        .on("style", {
            element(e) { if (!scope) e.remove(); else for (const [name] of [...e.attributes]) e.removeAttribute(name); },
            text(t) {
                if (!scope) return;
                css += t.text;
                if (t.lastInTextNode) { t.replace(scopeCss(css, scope), { html: false }); css = ""; } else t.remove();
            },
        })
        .on("*", {
            element(e) {
                for (const [name, value] of [...e.attributes] as Array<[string, string]>) {
                    const n = name.toLowerCase();
                    if (n.startsWith("on") || n.startsWith("hx-") || n.startsWith("data-hx-") || n === "srcdoc" || n === "formaction" || n === "is") e.removeAttribute(name);
                    else if (URL_ATTRS.has(n) && unsafeUrl(value)) e.removeAttribute(name);
                    else if (n === "style" && /expression\s*\(|javascript:/i.test(value)) e.removeAttribute(name);
                }
            },
        });
    return rw.transform(String(opts.html ?? "").replace(/<!doctype[^>]*>/gi, "")).trim();
}
