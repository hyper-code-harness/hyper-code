import { Glob } from "bun";
import { resolve } from "node:path";
import { realpath } from "node:fs/promises";
import classify from "./classify";
import type { ProjectEntry } from "./classify";

// Directory segments that are runtime/test/scratch — never part of the app.
const IGNORED_SEGMENT = /^(_runtime|_test_.*|_tmp_.*|tmp_.*|node_modules)$/;
function isIgnoredPath(rel: string): boolean {
    return rel.split('/').some(seg => IGNORED_SEGMENT.test(seg));
}

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
        const glob = new Glob('**/*');
        for await (const rel0 of glob.scan(root.dir)) {
            // Private tool-result payloads are data, never executable runtime files.
            // Check the absolute path too: a .hyper source root hides that segment
            // from rel0, and a symlink may hide the entire result-store path.
            const absolute = resolve(root.dir, rel0);
            if ((absolute + '/').includes('/.hyper/results/')) continue;
            const canonical = await realpath(absolute).catch(() => absolute);
            if ((canonical + '/').includes('/.hyper/results/')) continue;
            if (isIgnoredPath(rel0)) continue;
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
