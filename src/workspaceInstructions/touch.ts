/**
 * Remember a successfully accessed workspace file for nested instruction discovery
 *
 * Call after a native read, write, or edit succeeds. Tracks only files on the active workspace host under its directory, with a durable 64-path cap; no file content is retained. Switching workspace replaces the old path selection.
 * @param opts.agent Agent whose current workspace instruction scopes should follow a successful file operation.
 * @param opts.path Absolute or workspace-relative file path successfully read or changed.
 * @param opts.host Explicit tool host; omitted uses the workspace host, local means this machine.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose current workspace instruction scopes should follow a successful file operation. */
        agent: types.agent.Agent;
        /** Absolute or workspace-relative file path successfully read or changed. */
        path: string;
        /** Explicit tool host; omitted uses the workspace host, local means this machine. */
        host?: string;
    },
): Promise<boolean> {
    const agent = opts.agent;
    const { resolve, relative, isAbsolute, posix } = await import('node:path');
    const host = String(agent.workspaceHost ?? '').trim();
    const requested = opts.host === 'local' ? '' : String(opts.host ?? host).trim();
    if (requested !== host || !opts.path || opts.path.includes(String.fromCharCode(0)) || Buffer.byteLength(opts.path) > 4096) return false;
    const dir = agent.workspaceDir || process.cwd();
    const paths = host ? posix : { resolve, relative, isAbsolute };
    let input = opts.path;
    if (!host && (input === '~' || input.startsWith('~/'))) input = (await import('node:os')).homedir() + input.slice(1);
    if (host && input.startsWith('~')) {
        if (input !== '~' && !input.startsWith('~/')) return false;
        // Only HOME is requested, never interpolated user path or local fallback.
        const home = await ctx.fns.remote.exec({host, command: 'printf \'%s\' "$HOME"', timeout: 5, maxOutput: 8192});
        if (home.timedOut || home.exitCode !== 0 || !posix.isAbsolute(home.stdout) || Buffer.byteLength(home.stdout) > 4096 || /[\x00\r\n]/.test(home.stdout)) return false;
        input = home.stdout + input.slice(1);
    }
    const absolute = paths.resolve(dir, input);
    const rel = paths.relative(dir, absolute);
    if (!rel || rel === '..' || rel.startsWith('../') || paths.isAbsolute(rel)) return false;
    const key = JSON.stringify([host, dir]);
    const workspaceChanged = () => JSON.stringify([String(agent.workspaceHost ?? '').trim(), agent.workspaceDir || process.cwd()]) !== key;
    const result = await ctx.fns.session.mutateScratchpad({id: agent.id, mutate: (pad: Record<string, any>) => {
        if (workspaceChanged()) return null;
        const old = pad.workspaceInstructions as types.workspaceInstructions.AgentInstructionsState | undefined;
        const state: types.workspaceInstructions.AgentInstructionsState = old?.key === key ? old : {key, paths: []};
        const prior = Array.isArray(state.paths) ? state.paths : [];
        const next = [...prior.filter(p => p !== absolute), absolute];
        const updated = {...state, paths: next.slice(-64), ...(next.length > 64 ? {pathsLimited: true} : {})};
        pad.workspaceInstructions = updated;
        return updated;
    }});
    if (workspaceChanged() || !result.result) return false;
    agent.scratchpad ??= {};
    agent.scratchpad.workspaceInstructions = result.result;
    return true;
}
