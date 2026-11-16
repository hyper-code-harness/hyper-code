// Load one vendored Matt Pocock skill verbatim, with the skills it calls and its companion files.
// ctx.fns.mattpocockSkills.get({ name: "grilling", include?: ["tests.md"], follow?: true }) → { name, markdown, called, files, hyper }
import { resolve } from "node:path";

const HYPER_NOTES = [
    "You run in Hyper, not Claude Code. Map the skill's harness words like this:",
    "- \"Call the Skill tool with X\" → the text of X is in `called` below (or ctx.fns.mattpocockSkills.get({ name: \"X\" })).",
    "- \"sub-agent / background agent with a fresh context window\" → ctx.fns.agent.delegate({ agent, title, tasks }); the child starts with its own context and reports back by message.",
    "- \"ask the user\" → plain chat for open questions; ctx.fns.input.request({ kind: \"choice\" | \"confirm\" }) only when the answer is one of a few fixed options.",
    "- \"issue tracker\" / tickets → ctx.fns.session.plan for this session, the tasks plugin for durable tickets, or a local .scratch/ folder if the repo already uses one.",
    "- GLOSSARY.md and ADRs → files in the repo when the work is on a repo; otherwise project memory: memory.write({ path: \"notes/glossary.md\" | \"notes/adr/<n>-<slug>.md\", visibility: \"project\" }).",
    "- handoff document → memory.write({ path: \"notes/where-we-stopped.md\" }) rather than $TMPDIR.",
    "- \"/setup-matt-pocock-skills\" is not needed: use the mappings above instead of a per-repo config.",
].join("\n");

/**
 * Returns one vendored Matt Pocock skill verbatim — its SKILL.md, the skills it delegates to, and any companion reference files — plus a short map from Claude Code terms to Hyper tools.
 *
 * Use to follow a skill yourself or hand it to a delegated child as instructions: e.g.
 * get({ name: "grill-with-docs" }) returns the two-line wrapper plus the full text of
 * grilling and domain-modeling; get({ name: "tdd", include: ["tests.md", "mocking.md"] })
 * adds the disclosed reference files. The upstream text is never rewritten; the Hyper
 * mapping is returned separately in `hyper`. Names come from mattpocockSkills.list.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Skill name as in mattpocockSkills.list, e.g. "grilling", "tdd", "diagnosing-bugs", "code-review". */
    name: string;
    /** Companion files of this skill to append (relative to its folder, e.g. "tests.md"); "*" appends all of them. @default [] */
    include?: string[];
    /** Also return the text of every skill this one calls through the Skill tool, one level deep. @default true */
    follow?: boolean;
}): Promise<{
    name: string;
    bucket: string;
    markdown: string;
    called: { name: string; markdown: string }[];
    files: { path: string; markdown: string }[];
    available: string[];
    hyper: string;
    credit: string;
}> {
    const root = resolve(import.meta.dir, "../../vendor/mattpocock-skills/skills");
    const catalogue = (await ctx.fns.mattpocockSkills.list({})).skills;
    const find = (n: string) => catalogue.find((s) => s.name === n);
    const row = find(opts.name);
    if (!row) throw new Error(`mattpocockSkills.get: no skill "${opts.name}". Known: ${catalogue.map((s) => s.name).join(", ")}`);
    const read = (bucket: string, name: string, file: string) => Bun.file(resolve(root, bucket, name, file)).text();

    const markdown = await read(row.bucket, row.name, "SKILL.md");
    const called: { name: string; markdown: string }[] = [];
    if (opts.follow !== false) {
        for (const n of row.calls) {
            const c = find(n);
            if (c && c.name !== row.name) called.push({ name: c.name, markdown: await read(c.bucket, c.name, "SKILL.md") });
        }
    }
    const want = opts.include ?? [];
    const pick = want.includes("*") ? row.files : want;
    const files: { path: string; markdown: string }[] = [];
    for (const p of pick) {
        if (!row.files.includes(p)) throw new Error(`mattpocockSkills.get: "${row.name}" has no file "${p}". Available: ${row.files.join(", ") || "(none)"}`);
        files.push({ path: p, markdown: await read(row.bucket, row.name, p) });
    }
    return {
        name: row.name,
        bucket: row.bucket,
        markdown,
        called,
        files,
        available: row.files,
        hyper: HYPER_NOTES,
        credit: "Skill by Matt Pocock (MIT) — https://github.com/mattpocock/skills",
    };
}
