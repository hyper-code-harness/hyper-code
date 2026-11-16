// Attribution and provenance of the vendored Matt Pocock skills.
// ctx.fns.mattpocockSkills.about({}) → { author, upstream, license, commit, version, fetchedAt, credit }
import { resolve } from "node:path";

/**
 * Reports who wrote the vendored agent skills, under which licence, and which upstream commit and version are pinned here.
 *
 * Use whenever these skills are quoted, shared or published so the credit travels with
 * them, and to check whether the local copy is stale against github.com/mattpocock/skills.
 * Reads vendor/mattpocock-skills/PROVENANCE.json written at vendoring time; no network.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<{
    author: string;
    upstream: string;
    license: string;
    commit: string;
    version: string;
    fetchedAt: string;
    buckets: string[];
    fileCount: number;
    credit: string;
}> {
    const abs = resolve(import.meta.dir, "../../vendor/mattpocock-skills/PROVENANCE.json");
    const p = JSON.parse(await Bun.file(abs).text()) as {
        author: string; upstream: string; license: string; commit: string; version: string;
        fetchedAt: string; buckets: string[]; files: string[];
    };
    return {
        author: p.author,
        upstream: p.upstream,
        license: p.license,
        commit: p.commit,
        version: p.version,
        fetchedAt: p.fetchedAt,
        buckets: p.buckets,
        fileCount: p.files.length,
        credit: `Skills by ${p.author} (${p.license}) — ${p.upstream} @ ${p.commit.slice(0, 7)}`,
    };
}
