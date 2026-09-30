import projectRootFn from "../project/projectRoot";

// What this process is made of, in one list, assembled from two files with
// different owners:
//
//   package.json   `procs.modules`  — what the REPO ships. Committed, reviewed,
//                                     the same for everyone who clones it.
//   workspace.json `modules`       — what THIS MACHINE mounts on top. Gitignored
//                                     (see workspace.example.json), written by
//                                     modules.add, holds absolute paths into
//                                     $HOME and per-machine config.
//
// The split is the point: the second file is where a path like
// /Users/me/.hyper/user/linkedin belongs, and such a path in the first one is a
// mount nobody else can satisfy. The key is the namespace the module is mounted
// under — never the package's own preference — and the value says where it
// comes from and how it is configured:
//
//   "modules": {
//     "billing":  {},                                 // a folder found on PROCS_PATH
//     "vitals":   { "npm": "@hs/measures" },           // an installed package
//     "labs":     { "path": "./tools/labs" },          // a folder in the project
//     "reports":  { "git": "https://…/reports" },      // a repo, cloned on fetch
//     "aidbox":   { "license": "…" },                  // found, and configured
//     "agent":    false,                               // excluded — never mounted
//     "*":        {}                                   // mount the whole library
//   }
//
// `false` is what makes this list a boundary rather than a preference: it is
// applied when the folders are picked, before anything is scanned.
//
// Read on the bootstrap path (project/modules imports it directly), so it takes
// the workdir rather than reaching for ctx.fns.
/**
 * Reads effective module declarations from the host package and workspace manifest.
 * Workspace declarations override host declarations; `false` explicitly excludes a module.
 * @param opts.workdir Workspace directory containing the optional `workspace.json` manifest.
 */
export default async function (ctx: Context, session: Session | null, opts: { workdir: string }): Promise<Record<string, Record<string, any> | false>> {
    const app = await Bun.file(`${projectRootFn(ctx, session, {})}/package.json`).json()
        .then((pkg: any) => pkg.procs?.modules ?? pkg.proc?.modules ?? {})
        .catch(() => ({}));
    const project = await Bun.file(`${opts.workdir}/workspace.json`).json()
        .then((manifest: any) => manifest.modules ?? manifest.plugins ?? {})   // `plugins` is the older spelling
        .catch(() => ({}));
    // `false` is meaningful — "not mounted, do not read its files". Anything
    // else that is not an object is a typo, not a shape we support.
    return Object.fromEntries(Object.entries({ ...app, ...project })
        .map(([name, spec]) => [name, spec === false ? false : spec && typeof spec === "object" ? spec as Record<string, any> : {}]));
}
