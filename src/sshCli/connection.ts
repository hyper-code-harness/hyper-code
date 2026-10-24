/** Build a verified, non-multiplexed SSH invocation for an explicitly enabled config alias.
 * @param opts.host Enabled alias in the user's OpenSSH configuration.
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Enabled SSH config alias. */ host: string }): Promise<{ bin: string; args: string[]; host: string }> {
    ctx.fns.sshCli.authorize({});
    if (!(await ctx.fns.sshCli.hosts({})).includes(opts.host)) throw new Error('SSH CLI instance is not enabled');
    const servers = await ctx.fns.remote.servers({});
    if (!servers.some(s => s.name === opts.host)) throw new Error('SSH alias is not declared');
    const { bin, configFile } = await ctx.fns.remote.sshOptions({ persist: false });
    // A pre-existing master may have been established without host verification.
    // Do not reuse it. Explicit command-line values override permissive config.
    return { bin, host: opts.host, args: ['-F', configFile, '-T', '-S', 'none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '--'] };
}
