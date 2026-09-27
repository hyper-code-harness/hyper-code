/**
 * Closes the persistent SSH connection to a server so the next call reconnects.
 *
 * Sends `ssh -O exit` to the ControlMaster socket shared by remote.* and host-aware tools. Use it when a connection hangs, after changing ~/.ssh/config or keys, or to drop idle connections. Omit host to close all of them.
 * @param opts.host SSH host alias to disconnect; omitted closes every open connection.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias to disconnect; omitted closes every open connection. */
        host?: string;
    },
): Promise<{ closed: string[] }> {
    const { join } = await import("node:path");
    const { readdir } = await import("node:fs/promises");
    const ssh = await ctx.fns.remote.sshOptions({ persist: false });
    const dir = ssh.controlDir;
    const hosts = opts.host ? [opts.host] : (await ctx.fns.remote.servers({})).map(s => s.name);
    const closed: string[] = [];
    for (const h of hosts) {
      if (!/^[A-Za-z0-9._@-]+$/.test(h)) throw new Error("invalid host: " + h);
      const p = Bun.spawn({ cmd: [ssh.bin, "-O", "exit", ...ssh.args, h], stdout: "ignore", stderr: "ignore" });
      if ((await p.exited) === 0) closed.push(h);
    }
    if (!opts.host) {
      // Sockets of hosts no longer in ~/.ssh/config: nothing to talk to, remove the files.
      for (const f of await readdir(dir).catch(() => [] as string[])) {
        const p = Bun.spawn({ cmd: [ssh.bin, "-O", "check", "-o", "ControlPath=" + join(dir, f), "_"], stdout: "ignore", stderr: "ignore" });
        if ((await p.exited) !== 0) await Bun.file(join(dir, f)).delete().catch(() => {});
      }
    }
    return { closed };
}
