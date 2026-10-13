import { writeFileSync, renameSync, readFileSync, existsSync, statSync, lstatSync, unlinkSync } from "node:fs";


/**
 * Atomically replaces user-managed services in servicesFile (0600), preserving
 * immutable base services. Without servicesFile, writes only a user-owned config,
 * and optionally waits for the agent to report the new set to the control
 * plane. Low-level helper behind hyperlet.publish and hyperlet.unpublish.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Full new service list. */
    services: Array<{ name: string; port: number; scheme: "http" | "https"; kind: "hyper" | "http" | "git"; health: string }>;
    /** Seconds to wait for the agent report. @default 20 @minimum 0 @maximum 120 */
    wait?: number;
    /** Active agent config or operator descriptor path. @default "/etc/hyperlet-hn/config.json" */
    path?: string;
}): Promise<{ confirmed: boolean; report: any }> {
    const cfg = await ctx.fns.hyperlet.config({ path: opts.path });
    const sorted = [...opts.services].sort((a, b) => a.name < b.name ? -1 : 1);
    const base = cfg.raw.intent.services as typeof sorted;
    if (cfg.servicesPath && base.some(s => !sorted.some(next => JSON.stringify(next) === JSON.stringify(s)))) throw new Error("Base agent services are operator-managed; cannot change or remove them through servicesFile");
    const target = cfg.servicesPath ?? cfg.path;
    const st = lstatSync(target, { throwIfNoEntry: false });
    if (st && (!st.isFile() || st.uid !== process.getuid?.())) throw new Error(`Hyperlet write target must be a regular file owned by this user: ${target}`);
    const next = cfg.servicesPath ? sorted.filter(s => !base.some(b => b.name === s.name)) : { ...cfg.raw, intent: { ...cfg.raw.intent, services: sorted } };
    const tmp = `${target}.${Bun.randomUUIDv7()}.tmp`;
    try {
        writeFileSync(tmp, JSON.stringify(next, null, 1) + "\n", { mode: 0o600, flag: "wx" });
        renameSync(tmp, target);
    } finally { if (existsSync(tmp)) unlinkSync(tmp); }
    const written = statSync(target).mtimeMs;
    const file = cfg.statePath;
    const want = sorted.map(s => s.name).sort().join(",");
    const deadline = Date.now() + Math.max(0, Math.min(Number(opts.wait ?? 20), 120)) * 1000;
    let report: any = null;
    while (Date.now() < deadline) {
        await Bun.sleep(1000);
        if (!existsSync(file)) continue;
        report = JSON.parse(readFileSync(file, "utf8"));
        if (!Number.isFinite(Date.parse(report.at)) || Date.parse(report.at) < written) continue;
        if (!report.ok) return { confirmed: false, report };
        const seen = [...(report.services ?? []), ...(report.refused ?? [])].sort().join(",");
        if (seen === want) return { confirmed: true, report };
    }
    return { confirmed: false, report };
}
