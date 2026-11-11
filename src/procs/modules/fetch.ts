// hyper-code2: this used to shallow-clone every `git` module of workspace.json into
// WORKDIR/.claude/skills/<namespace> and run `bun install` there — at boot and on every
// reload, with no preview, no pinned commit and no lock. Plugins now arrive one way only:
// plugins.install puts a reviewed git clone into USER_PLUGINS and records it in the plugin
// lock. The function stays because boot ($main.ts) and modules.reload call it; it clones nothing.
// A folder an older version already cloned into .claude/skills keeps mounting (discover).
/**
 * Reports that nothing was fetched: modules are no longer cloned from workspace.json `git` entries
 *
 * Kept for boot and procs.modules.reload, which call it before mounting. It reads nothing, clones nothing and
 * installs nothing. To install a plugin from a git repository use plugins.install (a reviewed clone in
 * USER_PLUGINS, recorded in the plugin lock).
 * @param opts.name Ignored; kept for callers of the former fetch.
 */
export default async function (_ctx: Context, _session: Session | null, _opts?: { name?: string }) {
    return { fetched: [] as string[] };
}
