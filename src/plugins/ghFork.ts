/**
 * Forks a GitHub repository to the signed-in gh account and returns the fork's clone URL
 *
 * Use from plugins.fork. Runs `gh api -X POST repos/<owner>/<repo>/forks` with the machine's gh authentication;
 * GitHub returns the existing fork when the account already has one. Only github.com repositories are supported.
 * @param opts.repo Repository as `owner/repo`.
 */
export default async function (_ctx: Context, _session: Session | null, opts: {
    /** Repository as `owner/repo`. */
    repo: string;
}): Promise<{ url: string; fullName: string }> {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(String(opts.repo ?? ''))) throw new Error('Repository must be owner/repo');
    const p = Bun.spawn(['gh', 'api', '-X', 'POST', `repos/${opts.repo}/forks`], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GH_PROMPT_DISABLED: '1' } });
    const timer = setTimeout(() => p.kill(), 60_000);
    const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    clearTimeout(timer);
    if (code) throw new Error(`gh could not fork ${opts.repo}: ${(err.trim().split('\n').at(-1) ?? String(code)).slice(0, 300)}`);
    const body = JSON.parse(out);
    if (typeof body?.clone_url !== 'string' || typeof body?.full_name !== 'string') throw new Error('Unexpected gh response');
    return { url: body.clone_url, fullName: body.full_name };
}
