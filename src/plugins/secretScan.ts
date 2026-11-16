/**
 * Looks through the files a plugin would publish for things that must not leave this machine: private keys, access tokens of well-known services, and committed .env files
 *
 * Use before a plugin's code goes to a repository other people read (plugins.publish does and refuses on a finding).
 * It reads the files git tracks in the plugin's clone — not ignored or untracked ones, which are not published —
 * skipping binaries and files over 1 MB, and reports where something was found: the file, the line and what kind of
 * thing it looks like. The value itself is never returned or logged. It knows unmistakable shapes only (a PEM private
 * key block, GitHub, Slack, AWS, Google, OpenAI/Anthropic and Stripe token prefixes), so a clean answer is not a
 * proof that the plugin holds no secret: a password in plain words is not recognised.
 * @param opts.name Plugin name (folder under USER_PLUGINS).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name (folder under USER_PLUGINS). */
    name: string;
}): Promise<{ files: number; findings: Array<{ file: string; line: number; kind: string }> }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { dir } = await ctx.fns.plugins.cloneDir({ name: opts.name });
    const tracked = (await ctx.fns.plugins.cloneDir({ name: opts.name, args: ['ls-files', '-z'] })).stdout.split('\0').filter(Boolean);
    const KINDS: Array<[string, RegExp]> = [
        ['private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
        ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/],
        ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/],
        ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
        ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
        ['API key (sk-…)', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}\b/],
        ['Stripe key', /\b[sr]k_live_[0-9A-Za-z]{20,}\b/],
    ];
    const findings: Array<{ file: string; line: number; kind: string }> = [];
    let files = 0;
    for (const file of tracked.slice(0, 5000)) {
        if (/(^|\/)\.env(\.(?!example$|sample$|template$)[^/]*)?$/.test(file)) { findings.push({ file, line: 0, kind: 'committed .env file' }); continue; }
        const st = await fs.lstat(path.join(dir, file)).catch(() => null);
        if (!st?.isFile() || st.size > 1_000_000) continue;
        const buf = await fs.readFile(path.join(dir, file));
        if (buf.subarray(0, 8000).includes(0)) continue;
        files++;
        const lines = buf.toString('utf8').split('\n');
        for (let i = 0; i < lines.length && findings.length < 50; i++)
            for (const [kind, re] of KINDS) if (re.test(lines[i]!)) { findings.push({ file, line: i + 1, kind }); break; }
    }
    return { files, findings };
}
