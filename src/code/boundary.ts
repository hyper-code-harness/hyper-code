// Who is allowed to call whom.
//
// Tiers, most shared first:
//
//   core      src/ — the framework. Everyone has it.
//   official  plugins/* — shipped in this repo, but mountable and unmountable.
//   local     .hyper/ — committed, but personal glue for THIS checkout. It is
//             where private plugins are meant to be wired together, so it is
//             allowed to reach anywhere.
//   user      ~/.hyper/user/* — private, per machine, NOT in this repo.
//   external  cloned from a git url.
//
// The failure this exists to catch actually happened: three committed files in
// src/ needed a private Apple Health plugin. They compiled, passed review, and
// would throw for anyone else the first time they ran.
//
// Two severities, because two different things go wrong:
//
//   error   core or official → a private `user`/`external` plugin. Absent from a
//           fresh clone, so it is broken for everyone but this machine.
//   warn    core → `official` plugin. The code IS in the repo, so a clone works,
//           but a plugin is something a project mounts and unmounts — core
//           reaching into one is an inverted dependency waiting to break.
//
// `ok` reflects errors only: a warning is a design smell, not a broken build,
// and a check that fails on smells gets switched off.
//
// Deliberately NOT a general-purpose rules engine. One question, asked well,
// beats a DSL nobody writes rules in.

const SHARED_ORDER = ["core", "official", "user", "external"] as const;
const PRIVATE = new Set(["user", "external"]);
// `local` is the owner's own glue — judging it would report the thing it is for.
const EXEMPT_FROM = new Set(["local"]);

/**
 * Reports calls that cross a module-ownership boundary the wrong way.
 *
 * Flags edges from code the repository ships into code it does not: a function
 * in `src/` or `plugins/` that calls a private `~/.hyper/user` plugin works on
 * one machine and throws in a fresh clone. Those are `error`; core reaching into
 * an official plugin is `warn`, since a clone has the code but the dependency is
 * inverted. Reads the indexed graph, so run `code.index` first if the tree
 * changed. `ok` is true when there are no errors, which makes it usable as a
 * check.
 *
 * @param opts.from Only report violations originating in this tier: `core`, `official`, `user` or `external`.
 * @param opts.severity Only report this severity: `error` for broken-in-a-clone, `warn` for inverted dependencies.
 * @param opts.includeTests Also inspect calls made from `*.test.ts` files. @default false
 * @param opts.limit Maximum violations to return. @default 50 @minimum 1 @maximum 500
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts?: { from?: "core" | "official" | "user" | "external"; severity?: "error" | "warn"; includeTests?: boolean; limit?: number },
): Promise<{
    ok: boolean; errors: number; warnings: number; total: number;
    violations: Array<{ severity: "error" | "warn"; caller: string; callee: string; rel: string; line: number; fromTier: string; toTier: string; reason: string }>;
    byPair: Record<string, number>;
}> {
    const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 500);

    // The tier of the callee comes from the function it names, so an edge is
    // only judged when both ends are known: an unresolved callee is a different
    // problem (code.index reports it) and must not masquerade as a violation.
    const rows = await ctx.fns.procs.db.select({
        sql: `
            SELECT c.caller, c.callee, c.rel, c.line,
                   caller_fn.tier AS from_tier, callee_fn.tier AS to_tier
              FROM code_calls c
              JOIN code_functions caller_fn ON caller_fn.name = c.caller
              JOIN code_functions callee_fn ON callee_fn.name = c.callee
             WHERE c.kind <> 'type' AND c.kind <> 'dynamic'
               ${opts?.includeTests ? "" : "AND c.kind <> 'test'"}
               AND caller_fn.tier <> callee_fn.tier
               ${opts?.from ? "AND caller_fn.tier = ?" : ""}
             ORDER BY c.rel, c.line`,
        params: opts?.from ? [opts.from] : [],
    });

    const rank = (tier: string) => {
        const i = SHARED_ORDER.indexOf(tier as any);
        return i === -1 ? SHARED_ORDER.length : i;   // an unknown tier is treated as the most private
    };

    const violations = rows
        .filter((r: any) => !EXEMPT_FROM.has(r.from_tier))
        .filter((r: any) => rank(r.to_tier) > rank(r.from_tier))
        .map((r: any) => {
            const severity: "error" | "warn" = PRIVATE.has(r.to_tier) ? "error" : "warn";
            return {
                severity,
                caller: r.caller, callee: r.callee, rel: r.rel, line: Number(r.line),
                fromTier: r.from_tier, toTier: r.to_tier,
                reason: severity === "error"
                    ? `${r.from_tier} code cannot depend on a private plugin — "${r.callee.split(".")[0]}" is mounted per machine and absent from a fresh clone`
                    : `${r.from_tier} code depends on the "${r.callee.split(".")[0]}" plugin — a clone has it, but core should not require a mountable module`,
            };
        })
        .filter((v: any) => !opts?.severity || v.severity === opts.severity);

    const byPair: Record<string, number> = {};
    for (const v of violations) {
        const key = `${v.fromTier} -> ${v.toTier}`;
        byPair[key] = (byPair[key] ?? 0) + 1;
    }

    const errors = violations.filter((v: any) => v.severity === "error").length;
    return {
        ok: errors === 0,
        errors,
        warnings: violations.length - errors,
        total: violations.length,
        // Errors first: the list is read top-down and the broken ones matter.
        violations: violations.sort((a: any, b: any) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)).slice(0, limit),
        byPair,
    };
}
