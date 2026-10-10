// Attribution and provenance of the vendored work-humanizer skill.
// ctx.fns.humanizer.about({}) → { author, upstream, license, commit, fetchedAt, files }
import { resolve } from "node:path";

/**
 * Reports who wrote the wrapped humanizing skill, under which licence, and which upstream commit is vendored here.
 *
 * Use whenever the rewritten text or these rules are shown, published or shared, so the
 * credit travels with them, and to check whether the local copy is stale against
 * github.com/phuryn/work-humanizer. Reads vendor/work-humanizer/PROVENANCE.json written
 * at vendoring time; performs no network request.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}): Promise<{
    author: string;
    upstream: string;
    authorPost: string;
    license: string;
    commit: string;
    fetchedAt: string;
    files: string[];
    credit: string;
}> {
    const abs = resolve(import.meta.dir, "../../vendor/work-humanizer/PROVENANCE.json");
    const raw = await Bun.file(abs).text();
    const p = JSON.parse(raw) as {
        author: string; upstream: string; authorPost: string; license: string;
        commit: string; fetchedAt: string; files: string[];
    };
    return {
        ...p,
        credit: `work-humanizer by ${p.author} (${p.license}) — ${p.upstream}`,
    };
}
