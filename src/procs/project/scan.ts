import { Glob } from "bun";
import { resolve } from "node:path";
import { readdir, realpath } from "node:fs/promises";
import classify from "./classify";
import type { ProjectEntry } from "./classify";

// Directory segments that are runtime/test/scratch — never part of the app.
const IGNORED_SEGMENT = /^(_runtime|_test_.*|_tmp_.*|tmp|tmp_.*|node_modules)$/;
// Memory files (~/.hyper/memory/, a repo's old .hyper/memory/) and private tool-result payloads are data.
const DATA_DIR = /\/\.hyper\/(results|memory)\//;

/**
 * Files under `dir`, relative to it. Never enters a scratch or data folder (agents' tmp holds 100k+ files),
 * and a folder it may not read is skipped with a warning instead of failing the whole scan — one root-owned
 * backup under some agent's tmp used to break genTypes, code.index and every page that scans. Like the glob it
 * replaces: no dot entries, symlinks are not followed.
 */
async function walk(dir: string, canonical: string, rel = "", out: string[] = []): Promise<string[]> {
    let items;
    try { items = await readdir(rel ? resolve(dir, rel) : dir, { withFileTypes: true }); }
    catch (e: any) { console.warn(`[project.scan] skipped ${resolve(dir, rel)}: ${e?.code ?? e?.message ?? e}`); return out; }
    for (const item of items) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
        const path = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) {
            if (IGNORED_SEGMENT.test(item.name)) continue;
            if (DATA_DIR.test(resolve(dir, path) + "/") || DATA_DIR.test(`${canonical}/${path}/`)) continue;
            await walk(dir, canonical, path, out);
        } else if (item.isFile()) out.push(path);
    }
    return out;
}
// Roots that carry project/agent functions (see procs/modules/discover) and the folders they may contain.
// ~/.hyper/src (procs/modules/discover): functions of the memory levels only — user, project, agent folders.
const FN_ROOT = /^memorySrc(_.+)?$/;
const FN_FOLDER = /^(user_[A-Za-z0-9_]{1,64}|project_[a-z][A-Za-z0-9]{0,62}|agent_[a-z0-9]{1,16})\//;

export type ScanEntry = ProjectEntry & { root: string; rootDir: string; namespace: string; module: string; projectRel: string; abs: string; fn?: any };

/**
 * Scans every discovered source root and classifies its runtime files.
 * Returns absolute locations plus root, namespace, module, and project-relative metadata.
 */
export default async function (ctx: Context, session: Session | null, _opts?: {}): Promise<ScanEntry[]> {
    // ctx.fns.procs.modules.discover may not be registered yet on the first bootstrap
    // pass (loadFns calls scan to populate the registry) — fall back to a
    // direct import (raw call, explicit args).
    const modules = (ctx.fns.procs as any)?.modules?.discover
        ? await ctx.fns.procs.modules.discover({})
        : await (await import("../modules/discover?t=" + Date.now())).default(ctx, session, {});
    // The namespaces this process already has from trees that are NOT somebody
    // else's project — the framework, the host's own src, the libraries it
    // ships. They are the host's url space, and a supervised project is allowed
    // to write PAGES into them (see below).
    const hostNamespaces = new Set<string>();
    for (const root of modules) {
        if (root.prefix) continue;
        for await (const rel of new Glob("*/").scan({ cwd: root.dir, onlyFiles: false })) hostNamespaces.add(rel.replace(/\/$/, ""));
    }

    const entries: ScanEntry[] = [];
    for (const root of modules) {
        // A name is a path inside a src root — `hs/ui/button.ts` is
        // `ctx.fns.hs.ui.button`, whether that src arrived as a folder, as an npm
        // package or as the app itself. Only a host mounting somebody else's
        // project under a name of its own sets a prefix.
        const ns: string = root.prefix ?? "";
        // The root itself may be a symlink (a mounted plugin); nothing inside is followed, so its realpath
        // is the one place a data folder could hide behind a link.
        const rootCanonical = await realpath(root.dir).catch(() => root.dir);
        if (DATA_DIR.test(resolve(root.dir) + "/") || DATA_DIR.test(rootCanonical + "/")) continue;
        for (const rel0 of await walk(root.dir, rootCanonical)) {
            // ~/.hyper/src takes nothing but `user_*/`, `project_<slug>/` and `agent_<id>/` folders — never a
            // platform namespace. A repo's own `.hyper/src` is not a module either.
            if (root.name === "hyper" && rel0.split('/')[0] === "src") continue;
            if (FN_ROOT.test(root.name) && !FN_FOLDER.test(rel0)) continue;
            // A template's own placeholder, in the PATH. Provisioning fills
            // `{{project}}` into a new workspace's name — including in file names
            // — but a template mounted where it stands (the EHR's demo apps are
            // symlinks to two of them) has never been provisioned, and a
            // placeholder must not reach a url any more than it may reach a page.
            // So it becomes the name this copy is mounted under, which is exactly
            // what `$loader_app` already does for a title.
            const rel = ns ? rel0.replaceAll("{{project}}", ns) : rel0;
            // Prefix the module's namespace onto the path BEFORE classify, so the
            // dotted registry path / route path is namespaced — but keep `abs`
            // pointing at the real file (which lives under the module's dir).
            const nsRel = ns ? ns + '/' + rel : rel;
            let meta = classify(ctx, session, { rel: nsRel });
            // …except for a PAGE a project writes into a host's own url space.
            // `src/ehr/patient/$id/cardio/vitals/$route__GET.ts` is a page of the
            // EHR — that is what the folder says, and the prefix would make it
            // `/app/ehr/…`, an address no host draws its rail around and nobody
            // can be given. Routes only: functions, state and config stay under
            // the prefix, so a project cannot quietly replace a host's function,
            // and a page that collides with a host's own address is refused by
            // name in `$loader_route`.
            if (ns && hostNamespaces.has(rel.split('/')[0]!)) {
                const bare = classify(ctx, session, { rel });
                if (bare.kind === 'route') meta = bare;
            }
            // The module this file belongs to: its dotted name, which is its
            // path. `namespace` is something else and much rarer — the prefix a
            // host mounted somebody else's tree under, and the only case where
            // `ctx.fns.app` means anything.
            const module = meta.moduleDir === '.' ? '' : meta.moduleDir.replaceAll('/', '.');
            // `rel` is namespaced (that is what makes routes and registry paths
            // namespaced); `projectRel` is the path inside the project that shipped
            // the file, which is the only one that project itself knows.
            entries.push({ ...meta, root: root.name, rootDir: root.dir, namespace: ns, module, projectRel: rel0, abs: resolve(root.dir, rel0) });
        }
    }
    return entries;
}
