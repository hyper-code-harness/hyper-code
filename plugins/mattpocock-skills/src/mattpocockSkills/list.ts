// Catalogue of the vendored Matt Pocock skills (engineering + productivity buckets).
// ctx.fns.mattpocockSkills.list({ invocation?: "user" | "model", bucket?, query? }) → { skills, total }
import { resolve } from "node:path";

type SkillRow = {
    name: string;
    bucket: "engineering" | "productivity";
    description: string;
    invocation: "user" | "model";
    argumentHint: string | null;
    calls: string[];
    files: string[];
    lines: number;
};

/**
 * Lists the vendored Matt Pocock agent skills with their one-line description, who invokes them, and which other skills they call.
 *
 * Use to pick a skill before loading it with mattpocockSkills.get: grilling a plan
 * (grilling, grill-with-docs), test-first work (tdd), hard bugs (diagnosing-bugs),
 * two-axis review (code-review), domain glossary and ADRs (domain-modeling), writing
 * skills and agent docs (writing-for-agents), and the idea → spec → tickets → implement
 * flow. invocation "user" marks a skill the person starts by name; "model" marks one
 * an agent may pick on its own. Reads the vendored copy only; no network.
 */
export default async function (ctx: Context, _session: Session | null, opts?: {
    /** Keep only skills of this invocation kind: "user" (started by the person by name) or "model" (an agent may start it itself). */
    invocation?: "user" | "model";
    /** Keep only one upstream bucket. */
    bucket?: "engineering" | "productivity";
    /** Case-insensitive substring matched against name and description. */
    query?: string;
}): Promise<{ skills: SkillRow[]; total: number }> {
    const root = resolve(import.meta.dir, "../../vendor/mattpocock-skills/skills");
    const rows: SkillRow[] = [];
    for await (const rel of new Bun.Glob("*/*/SKILL.md").scan({ cwd: root })) {
        const [bucket, name] = rel.split("/");
        if ((bucket !== "engineering" && bucket !== "productivity") || !name) continue;
        const raw = await Bun.file(resolve(root, rel)).text();
        const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        const fm: Record<string, string> = {};
        for (const line of (m?.[1] ?? "").split("\n")) {
            const i = line.indexOf(":");
            if (i > 0 && !line.startsWith(" ")) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
        }
        const body = m?.[2] ?? raw;
        const calls = [...new Set([...body.matchAll(/Skill tool (?:twice, )?(?:with|for) ((?:[`"][a-z-]+[`"](?:,? (?:and )?)?)+)/g)]
            .flatMap((x) => [...(x[1] ?? "").matchAll(/[`"]([a-z-]+)[`"]/g)].map((y) => y[1] ?? "")))].filter(Boolean);
        const files: string[] = [];
        for await (const f of new Bun.Glob("**/*.md").scan({ cwd: resolve(root, bucket, name) })) if (f !== "SKILL.md") files.push(f);
        rows.push({
            name: fm.name || name,
            bucket,
            description: fm.description || "",
            invocation: fm["disable-model-invocation"] === "true" ? "user" : "model",
            argumentHint: fm["argument-hint"] || null,
            calls,
            files: files.sort(),
            lines: raw.split("\n").length,
        });
    }
    const q = opts?.query?.toLowerCase();
    const skills = rows
        .filter((r) => !opts?.invocation || r.invocation === opts.invocation)
        .filter((r) => !opts?.bucket || r.bucket === opts.bucket)
        .filter((r) => !q || r.name.includes(q) || r.description.toLowerCase().includes(q))
        .sort((a, b) => a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name));
    return { skills, total: skills.length };
}
