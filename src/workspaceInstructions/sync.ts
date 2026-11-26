/**
 * Refresh workspace instructions at a safe model-request boundary
 *
 * Loads AGENTS.md and CLAUDE.md guidance before a provider request and appends a complete replacement only when its effective snapshot changed or was compacted away. Follows the agent workspace and successfully touched nested files without modifying the cached system prefix. No source bodies are kept in scratchpad.
 * @param opts.agent Agent with synchronized transcript, current workspace and compaction state; invoke after all previous tool results have been persisted.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent with synchronized transcript, current workspace and compaction state; invoke after all previous tool results have been persisted. */
        agent: types.agent.Agent;
    },
): Promise<{appended: boolean; reason: "changed" | "unchanged" | "tool-call-boundary" | "workspace-changed"}> {
    const { agent } = opts;
    const tail = (agent.messages ?? []).at(-1);
    if (tail?.role === 'assistant' && tail.tool_calls?.length) return {appended: false, reason: 'tool-call-boundary'};
    const dir = agent.workspaceDir || process.cwd();
    const host = String(agent.workspaceHost ?? '').trim();
    const key = JSON.stringify([host, dir]);
    const workspaceChanged = () => JSON.stringify([String(agent.workspaceHost ?? '').trim(), agent.workspaceDir || process.cwd()]) !== key;
    const old = agent.scratchpad?.workspaceInstructions as types.workspaceInstructions.AgentInstructionsState | undefined;
    const tracked = old?.key === key ? old.paths ?? [] : [];
    let snapshot: types.workspaceInstructions.InstructionsSnapshot;
    try {
        snapshot = await ctx.fns.workspaceInstructions.load({dir, host, paths: tracked});
    } catch {
        snapshot = {dir, host, root: dir, sources: [], warnings: ['Instruction discovery failed. Check filesystem access and remote connectivity; previous automatically loaded instructions must not be assumed current.']};
    }
    if (old?.key === key && old.pathsLimited) snapshot.warnings.push('Only the 64 most recently accessed file paths are tracked. Read instruction files explicitly before returning to older nested scopes.');
    if (workspaceChanged()) return {appended: false, reason: 'workspace-changed'};
    const rendered = await ctx.fns.workspaceInstructions.render({snapshot});
    const hash = new Bun.CryptoHasher('sha256').update(rendered).digest('hex');
    const marker = '<!-- hyper-workspace-instructions:' + hash + ' -->';
    // Use the same effective projection as the provider: a persisted marker may have
    // been compacted away or may be outside a fork's inherited prefix.
    const projection = await ctx.fns.agent.contextProjection({agentId: agent.id, model: agent.model, sleepContext: agent.sleepContext, rootMessages: agent.messages ?? []});
    if (workspaceChanged()) return {appended: false, reason: 'workspace-changed'};
    let latest = '';
    for (let i = projection.messages.length - 1; i >= 0; i--) {
        const message = projection.messages[i];
        if (message.role === 'user' && message.message_type === 'world_state' && typeof message.content === 'string' && message.content.startsWith('<!-- hyper-workspace-instructions:')) {
            latest = message.content.slice(0, message.content.indexOf('-->') + 3);
            break;
        }
    }
    const relevant = snapshot.sources.length > 0 || snapshot.warnings.length > 0 || !!latest || old?.delivered === true;
    const appended = relevant && latest !== marker;
    if (appended) {
        await ctx.fns.session.appendMessage({id: agent.id, message: {role: 'user', content: marker + '\n\n' + rendered, excluded_from_cursor: true, message_type: 'world_state'}});
        await ctx.fns.session.syncAgentState({agent});
    }
    // A workspace may change during append/persistence. The run loop retries
    // before sampling, so any already-written obsolete row is superseded.
    if (workspaceChanged()) return {appended, reason: 'workspace-changed'};
    if (appended || old?.key !== key || old?.hash !== hash) {
        const metadata = {hash, delivered: relevant, root: snapshot.root, checkedAt: Date.now(), sources: snapshot.sources.map(({content: _content, ...source}) => source), warnings: snapshot.warnings};
        const result = await ctx.fns.session.mutateScratchpad({id: agent.id, mutate: (pad: Record<string, any>) => {
            if (workspaceChanged()) return null;
            const previous = pad.workspaceInstructions as types.workspaceInstructions.AgentInstructionsState | undefined;
            const state: types.workspaceInstructions.AgentInstructionsState = previous?.key === key ? previous : {key, paths: []};
            const next = {...state, ...metadata};
            pad.workspaceInstructions = next;
            return next;
        }});
        if (workspaceChanged() || !result.result) return {appended, reason: 'workspace-changed'};
        agent.scratchpad ??= {};
        agent.scratchpad.workspaceInstructions = result.result;
    }
    return {appended, reason: appended ? 'changed' : 'unchanged'};
}
