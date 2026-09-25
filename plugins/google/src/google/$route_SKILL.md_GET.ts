// GET /<ns>/SKILL.md — render this skill's SKILL.md: the YAML frontmatter as a
// header card (name + description + keyword chips), then the markdown body.
import { marked } from "marked";
import { resolve } from "node:path";

/**
 * Serve the Google plugin skill documentation.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const abs = resolve(import.meta.dir, "../../SKILL.md");
    const raw = await Bun.file(abs).text();
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });

    // split YAML frontmatter (--- … ---) from the markdown body
    const fm: Record<string, string> = {};
    let body = raw;
    const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (m) {
        body = m[2];
        for (const line of m[1].split("\n")) {
            const i = line.indexOf(":");
            if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
    }
    const name = fm.name || "SKILL";

    // pull a trailing "Keywords: a, b, c" out of the description into chips
    let desc = fm.description || "";
    let keywords: string[] = [];
    const kw = desc.match(/keywords:\s*(.+)$/i);
    if (kw) {
        keywords = kw[1].split(/[,;]/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean);
        desc = desc.slice(0, kw.index).trim().replace(/\s*keywords:?\s*$/i, "");
    }
    const chips = keywords
        .map((k) => `<span class="inline-block text-2xs leading-5 rounded-full px-2 bg-[#eaeef2] text-[#57606a]">${esc(k)}</span>`)
        .join(" ");

    const card = `
<div class="border border-[#d0d7de] rounded-lg overflow-hidden mb-6">
  <div class="bg-[#f6f8fa] px-4 py-2.5 border-b border-[#d0d7de] flex items-baseline gap-2">
    <span class="font-mono text-base font-semibold text-[#1f2328]">${esc(name)}</span>
    <a href="/${esc(name)}" class="text-2xs text-[#0969da] hover:underline">/${esc(name)}</a>
    <span class="ml-auto text-2xs text-[#8c959f] font-mono">SKILL.md</span>
  </div>
  ${desc ? `<div class="px-4 py-3 text-sm leading-relaxed text-[#1f2328]">${esc(desc)}</div>` : ""}
  ${keywords.length ? `<div class="px-4 pb-3 flex flex-wrap gap-1.5">${chips}</div>` : ""}
</div>`;

    const html = await marked.parse(body);
    return {
        title: `${name} · SKILL.md`,
        main: `${card}<article class="prose max-w-none">${html}</article>
<div class="mt-6 text-xs text-[#8c959f] font-mono">${esc(abs)}</div>`,
    };
}
