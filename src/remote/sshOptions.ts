/**
 * Returns the shared OpenSSH command-line options used by every remote.* call: config file and persistent connection socket.
 *
 * Single source of the connection settings: BatchMode, keep-alives, ControlMaster/ControlPersist with sockets in ~/.ssh/hyper-cm (created 0700), `-F <file>` when ctx.env.HYPER_SSH_CONFIG points at an alternative ssh config (used by tests against a Docker sshd), and the ssh binary (ctx.env.HYPER_SSH_BIN, default ssh). Use it when spawning ssh, scp or rsync -e yourself so the call reuses the same connection.
 * @param opts.persist Include ControlMaster=auto/ControlPersist so the call may open the shared connection; false only reuses an existing one. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Include ControlMaster=auto/ControlPersist so the call may open the shared connection; false only reuses an existing one. @default true */
        persist?: boolean;
    },
): Promise<{ bin: string; args: string[]; configFile: string; controlDir: string }> {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const { mkdir } = await import("node:fs/promises");
    const custom = String(ctx.env.HYPER_SSH_CONFIG ?? "").trim();
    const configFile = custom || join(homedir(), ".ssh", "config");
    const controlDir = String(ctx.env.HYPER_SSH_CONTROL_DIR ?? "").trim() || join(homedir(), ".ssh", "hyper-cm");
    await mkdir(controlDir, { recursive: true, mode: 0o700 });
    const args = [
      ...(custom ? ["-F", custom] : []),
      "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
      "-o", "ControlPath=" + join(controlDir, "%C"),
      ...(opts.persist === false ? [] : ["-o", "ControlMaster=auto", "-o", "ControlPersist=30m"]),
    ];
    return { bin: String(ctx.env.HYPER_SSH_BIN ?? "").trim() || "ssh", args, configFile, controlDir };
}
