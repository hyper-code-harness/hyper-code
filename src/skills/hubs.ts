/**
 * Lists the curated collections of Agent Skills this instance knows where to look for
 *
 * Use to see where skills can come from before searching or previewing one: the publishers' own repositories
 * (Anthropic, OpenAI — trust `official`) and widely used community collections, each with its repository, what it
 * covers, and the GitHub stars and skills.sh installs recorded when the list was checked. Popularity is shown for
 * orientation only: it says nothing about whether a skill is safe to follow. The list is the file
 * src/skills/HUBS.json; `installed` says whether a pack from that repository is already installed.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {} = {}): Promise<Array<{ id: string; repo: string; publisher: string; trust: "official" | "community"; about: string; stars?: number; installs?: number; installed?: string }>> {
    const { resolve } = await import("node:path");
    const data = JSON.parse(await Bun.file(resolve(import.meta.dir, "HUBS.json")).text()) as { collections: Array<{ id: string; repo: string; publisher: string; trust: "official" | "community"; about: string; stars?: number; installs?: number }> };
    const { lock } = await ctx.fns.skills.lockFile({});
    const byRepo = new Map(Object.entries(lock.packs).map(([name, e]) => [e.repo.toLowerCase(), name]));
    return data.collections.map(c => ({ ...c, ...(byRepo.has(c.repo.toLowerCase()) ? { installed: byRepo.get(c.repo.toLowerCase())! } : {}) }));
}
