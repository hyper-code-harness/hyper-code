/**
 * Records which commit of Hyper this process runs and, when it differs from the last start, the commit it ran before
 *
 * Use once at start (plugins/$start.ts does). It is how a Hyper update is noticed whatever performed it — the
 * "Update and restart" button, a `git pull` and a restart from outside, a rollback: the record in
 * `.runtime/plugins-head.json` holds `head` (the commit now) and `previous` (the commit an update started from),
 * and plugins.dropped reads it to say which plugins the update took away. While plugins lost by an earlier update
 * are still missing, a further update keeps that earlier commit as `previous`, so two updates in a row do not
 * forget what the first one removed. Without git (an exported tree) it records nothing.
 */
export default async function (ctx: Context, _session: Session | null, _opts: {}): Promise<{ head: string | null; previous: string | null; changed: boolean }> {
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const root = ctx.fns.procs.project.projectRoot({});
    const r = await ctx.fns.git.run({ args: ['rev-parse', 'HEAD'], dir: root, host: 'local', allowFailure: true });
    const head = r.ok && /^[0-9a-f]{40,64}$/.test(r.stdout.trim()) ? r.stdout.trim() : null;
    if (!head) return { head: null, previous: null, changed: false };
    const file = path.join(ctx.fns.procs.project.runtimeDir({}), 'plugins-head.json');
    const rec = await fs.readFile(file, 'utf8').then(JSON.parse, () => null) as { head?: unknown; previous?: unknown } | null;
    const sha = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{40,64}$/.test(v) ? v : null;
    const was = sha(rec?.head), before = sha(rec?.previous);
    if (was === head) return { head, previous: before, changed: false };
    let previous: string | null = was;
    // An earlier update whose losses are still not installed stays the base of the comparison.
    if (was && before && (await ctx.fns.plugins.dropped({ from: before, to: was }).then(d => d.missing.length > 0, () => false))) previous = before;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + '.tmp', JSON.stringify({ head, previous, at: new Date().toISOString() }) + '\n');
    await fs.rename(file + '.tmp', file);
    return { head, previous, changed: !!was };
}
