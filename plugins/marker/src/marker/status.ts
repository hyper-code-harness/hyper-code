/** Reports whether the local Marker PDF runtime is installed and accelerated by Apple Metal.
 * Use before conversion to diagnose the executable, Python environment, PyTorch MPS,
 * machine resources, and the plugin's default output location.
 */
export default async function (
    _ctx: Context,
    _session: Session | null,
    _opts: {},
): Promise<{
    installed: boolean;
    executable: string | null;
    markerVersion: string | null;
    pythonVersion: string | null;
    torchVersion: string | null;
    mpsAvailable: boolean;
    machine: { chip: string | null; memoryGb: number | null; logicalCpus: number | null };
    defaultOutputRoot: string;
    error?: string;
}> {
    const run = async (args: string[]) => {
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: process.env });
        const [stdout, stderr, code] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        return { code, stdout: stdout.trim(), stderr: stderr.trim() };
    };
    const which = await run(["/bin/zsh", "-lc", "command -v marker_single"]);
    const executable = which.code === 0 && which.stdout ? which.stdout.split("\n")[0]! : null;
    const realExecutable = executable ? await (await import("node:fs/promises")).realpath(executable).catch(() => executable) : null;
    const python = realExecutable ? `${realExecutable.slice(0, realExecutable.lastIndexOf("/bin/"))}/bin/python` : "python3";
    const probe = await run([python, "-c", [
        "import json, platform",
        "d={'python':platform.python_version(),'marker':None,'torch':None,'mps':False}",
        "try:\n import importlib.metadata as m; d['marker']=m.version('marker-pdf')\nexcept Exception: pass",
        "try:\n import torch; d['torch']=torch.__version__; d['mps']=bool(torch.backends.mps.is_available())\nexcept Exception: pass",
        "print(json.dumps(d))",
    ].join("\n")]);
    let runtime: { python?: string; marker?: string | null; torch?: string | null; mps?: boolean } = {};
    try { runtime = JSON.parse(probe.stdout || "{}"); } catch { /* return probe error below */ }
    const hardware = await run(["/bin/zsh", "-lc", "printf '%s\\n' \"$(sysctl -n machdep.cpu.brand_string 2>/dev/null)\" \"$(sysctl -n hw.memsize 2>/dev/null)\" \"$(sysctl -n hw.ncpu 2>/dev/null)\""]);
    const [chip, memory, cpus] = hardware.stdout.split("\n");
    return {
        installed: Boolean(executable && runtime.marker),
        executable,
        markerVersion: runtime.marker ?? null,
        pythonVersion: runtime.python ?? null,
        torchVersion: runtime.torch ?? null,
        mpsAvailable: Boolean(runtime.mps),
        machine: {
            chip: chip || null,
            memoryGb: memory && Number.isFinite(Number(memory)) ? Math.round(Number(memory) / 1073741824) : null,
            logicalCpus: cpus && Number.isFinite(Number(cpus)) ? Number(cpus) : null,
        },
        defaultOutputRoot: `${process.env.HOME ?? "~"}/Documents/marker-output`,
        ...(probe.code === 0 ? {} : { error: probe.stderr || "Python runtime probe failed" }),
    };
}
