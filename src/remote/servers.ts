/**
 * Lists SSH server aliases declared in the user's ~/.ssh/config with resolved hostname, user and port.
 *
 * Returns the concrete Host aliases (wildcard patterns skipped) from ~/.ssh/config (or the file in HYPER_SSH_CONFIG), each resolved through `ssh -G` so Include/Match defaults apply. Use it to discover which server names can be passed as `host` to remote.exec and to host-aware tools (read, write, edit, bash).
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<Array<{ name: string; hostname: string; user: string; port: number }>> {
    const { configFile } = await ctx.fns.remote.sshOptions({ persist: false });
    const custom = String(ctx.env.HYPER_SSH_CONFIG ?? "").trim();
    const file = Bun.file(configFile);
    if (!(await file.exists())) return [];
    const names: string[] = [];
    for (const raw of (await file.text()).split("\n")) {
        const m = /^\s*Host\s+(.+)$/i.exec(raw);
        if (!m) continue;
        for (const n of m[1]!.trim().split(/\s+/)) {
            if (/[*?!]/.test(n) || names.includes(n)) continue;
            names.push(n);
        }
    }
    return await Promise.all(names.map(async (name) => {
        const p = Bun.spawn({ cmd: ["ssh", ...(custom ? ["-F", custom] : []), "-G", name], stdout: "pipe", stderr: "ignore" });
        const cfg = await new Response(p.stdout).text();
        const get = (k: string) => cfg.split("\n").find((l) => l.startsWith(k + " "))?.slice(k.length + 1).trim();
        return { name, hostname: get("hostname") ?? name, user: get("user") ?? "", port: Number(get("port") ?? 22) };
    }));
}
