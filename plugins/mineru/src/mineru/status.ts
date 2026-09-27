/** Reports the installed MinerU runtime and Apple Silicon MLX capability.
 * Use before local conversion to verify the isolated CLI, version, Python runtime,
 * MLX packages, processor architecture, and default output location.
 */
export default async function (_ctx: Context, _session: Session | null, _opts: {}): Promise<{
    installed: boolean;
    executable: string | null;
    version: string | null;
    pythonVersion: string | null;
    mlxVersion: string | null;
    mlxVlmVersion: string | null;
    architecture: string;
    appleSilicon: boolean;
    defaultBackend: "vlm-engine";
    defaultOutputRoot: string;
    error?: string;
}> {
    const run = async (args: string[]) => {
        const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", env: process.env });
        const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), code };
    };
    const which = await run(["/bin/zsh", "-lc", "command -v mineru"]);
    const executable = which.code === 0 ? which.stdout.split("\n")[0] || null : null;
    const version = executable ? await run([executable, "--version"]) : null;
    const toolPython = `${process.env.HOME ?? ""}/.local/share/uv/tools/mineru/bin/python`;
    const probe = await run([toolPython, "-c", "import json,platform,importlib.metadata as m; print(json.dumps({'python':platform.python_version(),'arch':platform.machine(),'mlx':m.version('mlx'),'mlx_vlm':m.version('mlx-vlm')}))"]);
    let runtime: any = {};
    try { runtime = JSON.parse(probe.stdout || "{}"); } catch { /* reported below */ }
    return {
        installed: Boolean(executable && version?.code === 0), executable,
        version: version?.stdout.match(/version\s+([\w.-]+)/i)?.[1] ?? null,
        pythonVersion: runtime.python ?? null, mlxVersion: runtime.mlx ?? null, mlxVlmVersion: runtime.mlx_vlm ?? null,
        architecture: runtime.arch ?? process.arch, appleSilicon: (runtime.arch ?? process.arch) === "arm64",
        defaultBackend: "vlm-engine", defaultOutputRoot: `${process.env.HOME ?? "~"}/Documents/mineru-output`,
        ...(probe.code === 0 ? {} : { error: probe.stderr || "MinerU Python environment probe failed" }),
    };
}
