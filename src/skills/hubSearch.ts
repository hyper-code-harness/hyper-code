/**
 * Searches for Agent Skills that are NOT installed yet: the skills.sh index and the curated collections
 *
 * Use when the person asks for a capability no installed skill covers ("is there a skill for X?"), or to offer a
 * skill for the task at hand. Asks skills.sh (a public index of skills in GitHub repositories, ranked by installs)
 * and matches the query against the curated collections of skills.hubs. Returns candidates only — repository, skill
 * name, installs, trust by origin, whether the repository is one of the curated collections (`curated`, with its
 * `publisher`), whether it is already installed. Official and curated repositories are listed first. Nothing is downloaded: look inside one with
 * skills.preview({ repo }), and offer it to the person with skills.propose({ repo, select }). The skills.sh address
 * is not a documented API; when it does not answer, `errors` says so and the collections still match.
 * @param opts.query What the skill should help with, at least two characters.
 * @param opts.limit Maximum candidates. @default 10 @minimum 1 @maximum 50
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** What the skill should help with, at least two characters. */
    query: string;
    /** Maximum candidates. @default 10 @minimum 1 @maximum 50 */
    limit?: number;
}): Promise<{
    skills: Array<{ repo: string; skill: string; installs: number | null; trust: "official" | "community"; curated: boolean; publisher: string | null; source: "skills.sh"; installed: boolean }>;
    collections: Array<{ id: string; repo: string; publisher: string; trust: "official" | "community"; about: string; installed?: string }>;
    errors: string[];
}> {
    const query = String(opts.query ?? "").trim();
    if (query.length < 2) throw new Error("skills.hubSearch: query needs at least two characters");
    const limit = Math.max(1, Math.min(50, Math.floor(Number(opts.limit ?? 10)) || 10));
    const errors: string[] = [];
    const hubs = await ctx.fns.skills.hubs({});
    const { lock } = await ctx.fns.skills.lockFile({});
    const installedSkills = new Set(Object.values(lock.packs).flatMap(e => Object.keys(e.skills).map(name => `${e.repo.toLowerCase()}#${name}`)));
    const official = (repo: string) => /^github:(anthropics|openai)\//i.test(repo) ? "official" as const : "community" as const;

    const skills: Array<{ repo: string; skill: string; installs: number | null; trust: "official" | "community"; curated: boolean; publisher: string | null; source: "skills.sh"; installed: boolean }> = [];
    const curated = new Map(hubs.map(hub => [hub.repo.toLowerCase(), hub]));
    try {
        const res = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (text.length > 1_000_000) throw new Error("answer too large");
        const data = JSON.parse(text) as { skills?: Array<{ source?: unknown; skillId?: unknown; name?: unknown; installs?: unknown }> };
        for (const item of (data.skills ?? []).slice(0, limit)) {
            const source = String(item.source ?? "");
            const skill = String(item.skillId ?? item.name ?? "");
            // skills.sh also lists skills served from web sites; only GitHub repositories can be previewed and installed here.
            if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(source) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) continue;
            const repo = `github:${source}`;
            const known = curated.get(repo.toLowerCase());
            skills.push({ repo, skill, installs: Number.isFinite(Number(item.installs)) ? Number(item.installs) : null, trust: official(repo), curated: Boolean(known), publisher: known?.publisher ?? null, source: "skills.sh", installed: installedSkills.has(`${repo.toLowerCase()}#${skill}`) });
        }
        // Install counts can be inflated and copies of a pack exist under other names: a publisher's own repository
        // and the curated collections come before the rest, whatever the counts say.
        const rank = (s: { trust: string; curated: boolean }) => s.trust === "official" ? 0 : s.curated ? 1 : 2;
        skills.sort((a, b) => rank(a) - rank(b) || (b.installs ?? 0) - (a.installs ?? 0));
    } catch (error: any) {
        errors.push(`skills.sh did not answer: ${String(error?.message ?? error).slice(0, 160)}`);
    }
    const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 1);
    const collections = hubs
        .map(hub => ({ hub, score: words.reduce((sum, word) => sum + (`${hub.id} ${hub.publisher}`.toLowerCase().includes(word) ? 4 : hub.about.toLowerCase().includes(word) ? 1 : 0), 0) }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8)
        .map(({ hub }) => ({ id: hub.id, repo: hub.repo, publisher: hub.publisher, trust: hub.trust, about: hub.about, ...(hub.installed ? { installed: hub.installed } : {}) }));
    return { skills, collections, errors };
}
