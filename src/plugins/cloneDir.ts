/**
 * Resolves an installed plugin's git clone in USER_PLUGINS and runs git commands in it
 *
 * Use from plugin development functions (plugins.edit, plugins.release, plugins.fork, plugins.syncUpstream) to
 * locate USER_PLUGINS/<name>, check it is the top of its own git repository and, with `args`, run one git command
 * there without a terminal prompt. Throws when the plugin is missing or not a clone; a failing command throws with
 * git's last stderr line unless allowFailure is set.
 * @param opts.name Plugin name (folder under USER_PLUGINS).
 * @param opts.args git arguments to run in the clone, without the leading "git".
 * @param opts.allowFailure Return the failed result instead of throwing. @default false
 * @param opts.timeoutMs Kill the command after this long. @default 120000
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name (folder under USER_PLUGINS). */
    name: string;
    /** git arguments to run in the clone, without the leading "git". */
    args?: string[];
    /** Return the failed result instead of throwing. @default false */
    allowFailure?: boolean;
    /** Kill the command after this long. @default 120000 */
    timeoutMs?: number;
}): Promise<{ dir: string; ok: boolean; code: number; stdout: string; stderr: string }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(String(opts.name ?? ''))) throw new Error('Invalid plugin name');
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!configured) throw new Error('USER_PLUGINS is not configured');
    const dir = path.join(path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir()))), opts.name);
    const stat = await fs.lstat(dir).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('Plugin is not installed: ' + opts.name);
    if (!(await fs.lstat(path.join(dir, '.git')).catch(() => null))) throw new Error(`${opts.name} is not a git clone`);
    if (!opts.args) return { dir, ok: true, code: 0, stdout: '', stderr: '' };
    const p = Bun.spawn(['git', '-c', 'advice.detachedHead=false', ...opts.args], {
        cwd: dir, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const timer = setTimeout(() => p.kill(), opts.timeoutMs ?? 120_000);
    const [stdout, stderr, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    clearTimeout(timer);
    if (code && !opts.allowFailure) throw new Error(`git ${opts.args[0]} failed: ${(stderr.trim().split('\n').at(-1) ?? String(code)).slice(0, 300)}`);
    return { dir, ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() };
}
