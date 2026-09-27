/**
 * Reports whether an SSH server is reachable and its OS, uptime, load, memory, disk and listening ports.
 *
 * One round trip over the persistent connection; works on macOS and Linux. Unreachable hosts return reachable=false with the error instead of throwing. Use it before remote work or to diagnose a slow machine.
 * @param opts.host SSH host alias from ~/.ssh/config, as returned by remote.servers.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** SSH host alias from ~/.ssh/config, as returned by remote.servers. */
        host: string;
    },
): Promise<{ host: string; reachable: boolean; error?: string; ms: number; hostname?: string; os?: string; uptime?: string; load?: string; cpus?: number; memory?: string; disk?: string; ports?: string[] }> {
    const script = [
      'echo "hostname=$(hostname)"',
      'if [ "$(uname)" = Darwin ]; then echo "os=macOS $(sw_vers -productVersion) $(uname -m)"; echo "cpus=$(sysctl -n hw.ncpu)"; echo "memory=$(( $(sysctl -n hw.memsize) / 1073741824 )) GB total, $(memory_pressure 2>/dev/null | awk -F: \'/free percentage/{gsub(/ /,"",$2); print $2}\') free"; else echo "os=$(. /etc/os-release 2>/dev/null; echo $PRETTY_NAME) $(uname -m)"; echo "cpus=$(nproc)"; echo "memory=$(free -h | awk \'/Mem:/{print $2" total, "$7" available"}\')"; fi',
      'echo "uptime=$(uptime | sed -E \'s/.*up ([^,]*(, *[0-9]+:[0-9]+)?).*/\\1/\')"',
      'echo "load=$(uptime | sed -E \'s/.*load averages?: //\')"',
      'echo "disk=$(df -h / | awk \'NR==2{print $3" used of "$2" ("$5")"}\')"',
      'if command -v lsof >/dev/null; then lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk \'NR>1{split($9,a,":"); print "port=" a[length(a)] " " $1}\' | sort -u -t= -k2n | head -40; else ss -ltnp 2>/dev/null | awk \'NR>1{n=split($4,a,":"); print "port=" a[n]}\' | sort -u | head -40; fi',
    ].join("\n");
    const r = await ctx.fns.remote.exec({ host: opts.host, command: script, timeout: 20 });
    if (r.exitCode === null || (r.exitCode === 255 && !r.stdout)) return { host: opts.host, reachable: false, error: (r.stderr || "timed out").trim(), ms: r.ms };
    const out: Record<string, string> = {};
    const ports: string[] = [];
    for (const line of r.stdout.split("\n")) {
      const i = line.indexOf("="); if (i < 0) continue;
      const k = line.slice(0, i), v = line.slice(i + 1).trim();
      if (k === "port") { if (!ports.some(p => p.split(" ")[0] === v.split(" ")[0])) ports.push(v); } else out[k] = v;
    }
    return { host: opts.host, reachable: true, ms: r.ms, hostname: out.hostname, os: out.os, uptime: out.uptime, load: out.load, cpus: Number(out.cpus) || undefined, memory: out.memory, disk: out.disk, ports };
}
