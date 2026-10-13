import { resolve, dirname } from "node:path";
import { readdir, realpath } from "node:fs/promises";
// Bootstrap path: this runs before the registry exists, so these are imported
// directly rather than called through ctx.fns.
import projectRootFn from "../project/projectRoot";
import workdirFn from "../project/workdir";
import modulePaths from "./paths";
import readDeclared from "./readDeclared";
import readPluginRegistry from "./readPluginRegistry";

// The modules of this process = the app's src/ (namespace "") + proc's own core src (the
// framework: http/repl/dev/config/lifecycle/…) + each mounted module's src.
// When running proc itself, the app root IS proc's root, so app src === core src
// and there is just one. When an app boots proc as a dependency (boot({root})),
// there are two: the app's code and proc's core, merged into one ctx.fns.
//
// A module reaches this list one of three ways, and the tier is what the
// workspace shows and what WORKDIR/workspace.json can change:
//   core      the workspace's own modules/     part of the workspace
//   project   WORKDIR/.claude/skills/*         the project's own — and the coding agent
//                                              reads the same folders as skills
//   platform  a global skill dir               everything on the machine
//   external  a git repo                       "x": { "git": … } — cloned into .claude/skills
//
// Mounted unless it is optional and nobody asked: a manifest that says
// `"optional": true` waits to be named in workspace.json, and a global skill
// directory is optional by nature — a machine has dozens, a project wants three.
// The ones skipped here are exactly what modules.catalog offers.
export type Root = {
    name: string; dir: string;
    // A tree is mounted UNDER a prefix only when a host says so (the project it
    // supervises, mounted as `app`). A module's own names come from the paths
    // inside its src — the package or folder that delivered it is not part of
    // any name.
    prefix?: string;
    folder?: string;   // the module directory itself — manifest and SKILL.md live here
    label?: string; icon?: string; description?: string; skill?: string | null;
    source?: "core" | "official" | "user" | "project" | "platform" | "external"; from?: string | null;
    /** Trusted package procs.domains: exact hostnames or explicit *.suffix rules. */
    domains?: string[];
    // The process itself — the framework and the host's own src. Mounted always,
    // removable never, and not a module anybody manages.
    self?: boolean;
    optional?: boolean; preview?: { files: string; fn: string } | null; config?: Record<string, any>;
    // A plugin is a container a project turns on and off — the module manager's
    // whole subject. It says so in its own manifest (`"plugin": true`); a
    // container that merely waits to be named (`"optional": true`) is one too,
    // which is what every skill and every optional library already is.
    plugin?: boolean;
};

/**
 * Discovers the source roots mounted into this process in override order.
 * Includes framework and host roots plus official, user, project, platform, and external modules.
 */
export default async function (ctx: Context, session: Session | null, _opts?: {}): Promise<Root[]> {
    const registry = await readPluginRegistry(ctx, session, {});
    const coreSrc = resolve(import.meta.dir, "../..");     // the framework's src root — this file lives in src/procs/modules/
    // Bootstrap dependencies must also refresh when package metadata grammar changes.
    const { default: describe } = await import("./describe?t=" + Date.now());
    const projectRoot = projectRootFn(ctx, session, {});   // boot({root}) / proc's repo root
    const appSrc = resolve(projectRoot, "src");
    const workdir = workdirFn(ctx, session, {});

    // core first, then app — so the app OVERRIDES core defaults (e.g. its own
    // GET / home page wins over proc's registry-listing home).
    const out: Root[] = [{ name: "core", dir: coreSrc, self: true }];
    // The host's own src is the HOST, not "app": `app` is the prefix a
    // supervised project is mounted under, and calling both by it put two rows
    // named "app" on the module manager with nothing to tell them apart.
    if (appSrc !== coreSrc) out.push({ name: await hostName(projectRoot), dir: appSrc, self: true });

    // hyper-code2: `.hyper/` is the runtime-writable overlay (agent-written
    // extensions). Scanned AFTER src so a `.hyper/<mod>/<fn>.ts` overrides
    // `src/<mod>/<fn>.ts` by the same name. `_runtime`/`_test_*`/`tmp_*` inside
    // it are dropped by the scanner's IGNORED_SEGMENT rule.
    const hyperDir = resolve(projectRoot, ".hyper");
    if (await readdir(hyperDir).then(() => true).catch(() => false)) {
        out.push({ name: "hyper", dir: hyperDir, self: true });
    }

    // An app declared `runtime: "in-process"` in workspace.json is mounted from
    // WORKDIR as a namespace of this process — services/start puts the directory
    // here and calls loadFns. It is a module in everything but where it lives.
    for (const [namespace, dir] of Object.entries(ctx.state.procs?.project?.appRoots ?? {})) {
        // The project's own app, declared under services — not something the
        // module manager can remove, so it is listed as part of the workspace.
        // Named after the project, not after the prefix it is mounted under:
        // `app` is where it landed, not what it is, and a row called "app" beside
        // the host's own row is two rows nobody can tell apart.
        out.push({ name: await hostName(resolve(dir as string, "..")), dir: dir as string, prefix: namespace, icon: "ph-app-window", source: "core", from: dir as string });
    }

    // The composition of this process, in one list: package.json `procs.modules`
    // and, for a supervised project, WORKDIR/workspace.json `modules` on top.
    const declared = await readDeclared(ctx, session, { workdir });

    // "vitals": { "npm": "@test/measures" } — an installed package mounted under
    // the name the APP gave the container; the names of what it ships come from
    // suggestion, so two packages that both want `ui` are a rename, not a wall.
    for (const [namespace, config] of Object.entries(declared)) {
        if (config === false || !config.npm) continue;
        const dir = resolveModuleDir(config.npm, projectRoot);
        if (!dir) { console.warn(`[modules] ${namespace}: cannot resolve "${config.npm}" — run bun add first?`); continue; }
        const manifest = await readManifest(dir);
        if (!manifest) { console.warn(`[modules] ${namespace}: ${config.npm} has no procs block`); continue; }
        out.push({
            ...await describe(ctx, session, { dir, name: namespace, manifest }),
            name: namespace, dir: resolve(dir, manifest.src ?? "src"), folder: dir, source: "external", from: config.npm, config,
        });
    }
    // Through realpath, because modulePaths resolves symlinks: a host that
    // shares one library directory (EHR/modules → workspace/modules) still owns
    // what is in it. Otherwise the shared library would look like somebody
    // else's catalogue and wait to be named one module at a time.
    // The host's OWN library — whatever it calls the folder. Anything in it is
    // part of the host and mounted without being asked for; the rest is a
    // catalogue the project opts into by name.
    // Everything the host itself named on its path is its own library — mounted
    // because the host ships it. Only the machine's skill directories are a
    // catalogue a project opts into by name.
    const named: string[] = await Bun.file(`${projectRoot}/package.json`).json()
        .then((pkg: any) => ((pkg.procs ?? pkg.proc)?.path ?? []) as string[])
        .catch(() => [] as string[]);
    const fromEnv = (ctx.env.PROCS_PATH ?? "").split(":").filter(Boolean);
    const ownDirs = await Promise.all([...named, ...fromEnv, "modules", "plugins", "libs"]
        .filter(d => !d.includes("skills"))
        .map(d => d.endsWith("/*") ? d.slice(0, -2) : d)
        .map(d => realpath(resolve(projectRoot, d)).catch(() => resolve(projectRoot, d))));

    // Any directory under PROCS_PATH that declares itself (a `procs` block in its
    // package.json — or the older atomic-workspace.json) is a
    // module. The workspace's own and the project's own are always on; the
    // global skill directories are a catalogue the project opts into by name.
    // Every folder already spoken for, by its real path — the roots above plus
    // whatever this loop has taken.
    const seen = new Set<string>(await Promise.all(out.map(r => realpath(r.folder ?? r.dir).catch(() => r.folder ?? r.dir))));
    for (const { dir: searchDir, prefixed, kind } of await modulePaths(ctx, session, {})) {
        for (const name of await readdir(searchDir).catch(() => [] as string[])) {
            // Kept as it was found — a host that installs an app by symlink
            // (`EHR/apps/ehr`) should say where IT put it, not where the file
            // happens to live. Compared through realpath, though: `.claude/skills`
            // is both a plugin path and where a turned-on plugin is linked, so
            // every linked module was otherwise found a second time through its
            // own link — two records, two tabs, one directory.
            const dir = resolve(searchDir, name);
            const real = await realpath(dir).catch(() => dir);
            if (seen.has(real)) continue;
            const manifest = await readManifest(dir, prefixed);
            if (!manifest) continue;
            // The folder's name identifies the CONTAINER — what may be excluded,
            // configured or offered in a catalogue. It is not a namespace: the
            // names of what it ships come from the paths inside its src.
            const namespace = name;
            // Declared `false` — not mounted at all. The list picks the folders
            // BEFORE the scan, so an excluded module's files are never opened,
            // never imported and never registered. "Not started" is not a
            // boundary; "not mounted" is.
            if (!registry && declared[namespace] === false) continue;
            const source: Root["source"] = kind === "official"
                ? "official"
                : kind === "user"
                    ? "user"
                    : ownDirs.includes(searchDir)
                        ? "core"
                        : searchDir.startsWith(workdir + "/") ? "project" : "platform";
            // USER_PLUGINS is an explicit writable mount root: every valid child
            // is active without a workspace.json declaration. Official and
            // platform plugins keep their existing opt-in behavior.
            const optional = kind === "user" ? false : manifest.optional === true || source === "platform";
            const plugin = kind === "official" || kind === "user" || manifest.plugin === true || optional;
            if (registry && !plugin && declared[namespace] === false) continue;
            // `"modules": { "*": {} }` — mount the whole library without naming it
            // module by module. A host (the EHR) wants every function it ships
            // available to the apps it installs; it does NOT want the machine's
            // global skill directories, so the wildcard covers the host's own
            // modules and the project's, never the `platform` catalogue.
            // A `…/*` path is a folder of installed projects: each is mounted
            // under its own folder name, so a host points at a directory of
            // projects rather than naming them one by one.
            const wildcard = ("*" in declared && source !== "platform") || prefixed;
            if (!registry && kind !== "user" && optional && !wildcard && !(namespace in declared)) continue;
            seen.add(real);
            out.push({
                ...await describe(ctx, session, { dir, name: namespace, manifest }),
                name: namespace, dir: resolve(dir, manifest.src ?? "src"), folder: dir, source, optional, plugin,
                config: (declared[namespace] || {}) as Record<string, any>,
                // A host installing somebody else's project mounts it under a name
                // of its own: `"ehr": { "prefix": "ehr" }`. That is the one place a
                // prefix exists, and it is what keeps two installed apps that both
                // ship `patients/` from being the same namespace.
                prefix: (declared[namespace] as any)?.prefix ?? (prefixed ? identifier(namespace) : undefined),
            });
        }
    }

    // External: a repo modules.fetch cloned into WORKDIR/.claude/skills, or a
    // folder the project ships somewhere else.
    // Naming a folder that the scan above already found is not a second module,
    // it is the same one said twice — and saying it twice used to produce two
    // records, which the boot-time collision guard then read as a plugin
    // shadowing itself and refused to start the whole app. A path declaration
    // is an instruction to MOUNT this folder, not a claim that it is new.
    for (const [namespace, config] of Object.entries(declared)) {
        if (config === false || config.npm) continue;
        const from = config.git ?? config.path;
        if (!from) continue;
        const dir = config.path ? resolve(workdir, config.path) : `${workdir}/.claude/skills/${namespace}`;
        const real = await realpath(dir).catch(() => dir);
        if (seen.has(real)) continue;
        const manifest = await readManifest(dir);
        if (!manifest) { console.warn(`[modules] ${namespace}: not fetched yet (${from}) — ctx.fns.procs.modules.fetch({})`); continue; }
        seen.add(real);
        out.push({
            ...await describe(ctx, session, { dir, name: namespace, manifest }),
            name: namespace, dir: resolve(dir, manifest.src ?? "src"), folder: dir, source: "external", from, optional: true, plugin: true, config,
        });
    }

    let selected = out;
    if (registry) {
        // Only metadata has been read above. No plugin module has been imported.
        const candidates = new Map<string, Root>();
        for (const candidate of out) {
            const real = await realpath(candidate.folder ?? candidate.dir).catch(() => candidate.folder ?? candidate.dir);
            if (candidate.plugin || candidate.source === "external") candidates.set(real, candidate);
        }
        selected = out.filter(candidate => !candidate.plugin && candidate.source !== "external");
        const names = new Map<string, string>();
        for (const entry of registry.entries) {
            if (!entry.enabled) continue;
            let candidate = candidates.get(entry.dir);
            if (!candidate) {
                const manifest = await readManifest(entry.dir);
                if (!manifest) throw new Error(`pluginRegistry path has no module manifest: ${entry.path}`);
                const name = entry.dir.split("/").pop()!;
                candidate = {
                    ...await describe(ctx, session, { dir: entry.dir, name, manifest }),
                    name, folder: entry.dir, dir: resolve(entry.dir, manifest.src ?? "src"),
                    source: "external", from: entry.path, optional: manifest.optional === true,
                    plugin: true, config: (declared[name] || {}) as Record<string, any>,
                    prefix: (declared[name] as any)?.prefix,
                };
            }
            if (!candidate) throw new Error(`Unresolved pluginRegistry entry: ${entry.path}`);
            if (selected.some(root => root.name === candidate!.name) || (names.has(candidate.name) && names.get(candidate.name) !== entry.dir)) throw new Error(`Conflicting pluginRegistry name: ${candidate.name}`);
            if (!await Bun.file(candidate.dir).stat().then(s => s.isDirectory()).catch(() => false)) throw new Error(`pluginRegistry source directory missing: ${candidate.dir}`);
            names.set(candidate.name, entry.dir);
            selected.push(candidate);
        }
    }
    const exist: Root[] = [];
    for (const r of selected) {
        if (await Bun.file(r.dir).stat().then(() => true).catch(() => false)) exist.push(r);
        else console.warn(`[modules] ${r.name}: src dir not found: ${r.dir}`);
    }
    return exist;
}

// A module says what it is in ONE place: the `procs` block of its own
// package.json. `atomic-workspace.json` is the older spelling of the same thing
// and is still read, so a checkout that has not moved over keeps working.
//
// `project: true` is for a folder of installed projects (a `…/*` path): what a
// manager creates is a workspace, and a workspace's manifest is its
// `workspace.json` — or nothing at all beside a `src/`. Having source is the
// declaration there; a host that points at that folder means every project in it.
async function readManifest(dir: string, project = false): Promise<any | null> {
    const pkg = await Bun.file(dir + "/package.json").json().catch(() => null);
    const declared = pkg?.procs ?? pkg?.proc ?? await Bun.file(dir + "/atomic-workspace.json").json().catch(() => null);
    if (declared || !project) return declared;
    if (!await Bun.file(dir + "/src").stat().then(s => s.isDirectory()).catch(() => false)) return null;
    const workspace = await Bun.file(dir + "/workspace.json").json().catch(() => null);
    return { src: "src", label: workspace?.label, icon: workspace?.icon, description: workspace?.description };
}

// A prefix becomes a segment of every name the project ships, and a name is
// addressed as `ctx.fns.<segment>.…` — so a folder called `aidbox-demo` cannot be
// one as it stands. A manager names workspaces freely, so the host does the
// mapping rather than refusing the folder: everything that is not an identifier
// character becomes `_`, which is stable, reversible enough to read, and what
// the routes (`/aidbox_demo/…`) then say.
function identifier(name: string): string {
    const out = name.replace(/[^A-Za-z0-9_$]/g, "_");
    return /^[0-9]/.test(out) ? "_" + out : out;
}

function resolveModuleDir(from: string, projectRoot: string): string | null {
    let f = from.startsWith("file:") ? from.slice(5) : from;
    if (f.startsWith(".") || f.startsWith("/")) return resolve(projectRoot, f);
    try { return dirname(Bun.resolveSync(f + "/package.json", projectRoot)); } catch { return null; }
}

// What this host calls itself: its package name, or the folder it lives in.
async function hostName(projectRoot: string): Promise<string> {
    const pkg = await Bun.file(`${projectRoot}/package.json`).json().catch(() => null);
    return String(pkg?.name || projectRoot.split("/").filter(Boolean).pop() || "host");
}
