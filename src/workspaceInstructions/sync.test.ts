import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testCtx } from '../$test';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true}))); });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'hyper-instruction-sync-')); roots.push(root);
    const dir = join(root, 'project'); const globalDir = join(root, 'home');
    await mkdir(dir); await mkdir(globalDir); await mkdir(join(dir, '.git'));
    const ctx: any = await testCtx();
    const original = ctx.state.registry.workspaceInstructions.load;
    ctx.state.registry.workspaceInstructions.load = (c: any, s: any, opts: any) => original(c, s, {...opts, globalDir});
    const agent = await ctx.fns.agent.start({model: 'mock:test', workspaceDir: dir});
    await ctx.fns.session.appendUserMessage({id:agent.id, text:'work'});
    await ctx.fns.session.syncAgentState({agent});
    return {ctx, agent, dir, root};
}
const instructionRows = (agent: any) => agent.messages.filter((m: any) => m.message_type === 'world_state' && typeof m.content === 'string' && m.content.startsWith('<!-- hyper-workspace-instructions:'));

test('first request loads both; unchanged requests do not repeat; external edits and removal replace', async () => {
    const {ctx, agent, dir} = await fixture();
    await writeFile(join(dir, 'AGENTS.md'), 'alpha rules');
    await writeFile(join(dir, 'CLAUDE.md'), 'beta rules');
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(true);
    expect(instructionRows(agent)).toHaveLength(1);
    expect(instructionRows(agent)[0].content).toContain('alpha rules');
    expect(instructionRows(agent)[0].content).toContain('beta rules');
    expect(instructionRows(agent)[0].excluded_from_cursor).toBe(true);
    expect(JSON.stringify(agent.scratchpad.workspaceInstructions)).not.toContain('alpha rules');
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(false);
    await writeFile(join(dir, 'AGENTS.md'), 'updated rules');
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(true);
    expect(instructionRows(agent).at(-1).content).toContain('replaces ALL earlier');
    expect(instructionRows(agent).at(-1).content).toContain('updated rules');
    expect(instructionRows(agent).at(-1).content).not.toContain('alpha rules');
    await rm(join(dir, 'AGENTS.md')); await rm(join(dir, 'CLAUDE.md'));
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(true);
    expect(instructionRows(agent).at(-1).content).toContain('no longer apply');
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(false);
});

test('empty workspace stays silent across requests and reload', async () => {
    const {ctx, agent} = await fixture();
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(false);
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(false);
    const reloaded = await ctx.fns.session.load({id: agent.id});
    expect((await ctx.fns.workspaceInstructions.sync({agent:reloaded})).appended).toBe(false);
    expect(instructionRows(reloaded)).toHaveLength(0);
});

test('native successful file tools activate nested scopes; errors and other hosts do not', async () => {
    const {ctx, agent, dir} = await fixture();
    await mkdir(join(dir, 'nested')); await writeFile(join(dir, 'nested/AGENTS.md'), 'nested rules');
    await writeFile(join(dir, 'nested/file.txt'), 'file');
    expect((await ctx.fns.tools.call({name:'read', args:{path:'nested/missing.txt'}, agent})).isError).toBe(true);
    expect(agent.scratchpad.workspaceInstructions?.paths ?? []).toHaveLength(0);
    expect((await ctx.fns.tools.call({name:'read', args:{path:'nested/file.txt'}, agent})).isError).toBe(false);
    expect(agent.scratchpad.workspaceInstructions.paths).toEqual([join(dir, 'nested/file.txt')]);
    await ctx.fns.workspaceInstructions.sync({agent});
    expect(instructionRows(agent).at(-1).content).toContain('nested rules');
    expect(await ctx.fns.workspaceInstructions.touch({agent, path:'other/file.txt', host:'remote-other'})).toBe(false);
    expect(await ctx.fns.workspaceInstructions.touch({agent, path:'../outside/file.txt'})).toBe(false);
    expect((await ctx.fns.tools.call({name:'write', args:{path:'nested/new.txt',content:'hello'}, agent})).isError).toBe(false);
    expect((await ctx.fns.tools.call({name:'edit', args:{path:'nested/new.txt',edits:[{oldText:'hello',newText:'hi'}]},agent})).isError).toBe(false);
    expect(agent.scratchpad.workspaceInstructions.paths).toContain(join(dir,'nested/new.txt'));
});

test('switching workspace or host sends replacement and clears nested selection', async () => {
    const {ctx, agent, dir, root} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'old-project-rules');
    await ctx.fns.workspaceInstructions.touch({agent,path:'nested/file'});
    await ctx.fns.workspaceInstructions.sync({agent});
    const other = join(root,'other'); await mkdir(other);
    await ctx.fns.workspace.set({agent,dir:other});
    await ctx.fns.workspaceInstructions.sync({agent});
    expect(instructionRows(agent).at(-1).content).toContain('no longer apply');
    expect(instructionRows(agent).at(-1).content).not.toContain('old-project-rules');
    expect(agent.scratchpad.workspaceInstructions.paths).toEqual([]);
    let passed: any;
    ctx.state.registry.workspaceInstructions.load = async (_c: any, _s: any, opts: any) => {passed = opts; return {dir:opts.dir,host:opts.host,root:opts.dir,sources:[],warnings:['remote unavailable']};};
    agent.workspaceHost='remote'; agent.workspaceDir='/project';
    await ctx.fns.workspaceInstructions.sync({agent});
    expect(passed).toEqual({dir:'/project',host:'remote',paths:[]});
    expect(instructionRows(agent).at(-1).content).toContain('remote unavailable');
    expect(instructionRows(agent).at(-1).content).not.toContain('old-project-rules');
});

test('pending tool call is never split by an instruction row', async () => {
    const {ctx, agent, dir} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'rules');
    await ctx.fns.session.appendMessage({id:agent.id,message:{role:'assistant',content:'',tool_calls:[{id:'pending',name:'read',args:{path:'x'}}]}});
    await ctx.fns.session.syncAgentState({agent});
    expect(await ctx.fns.workspaceInstructions.sync({agent})).toEqual({appended:false,reason:'tool-call-boundary'});
    expect(instructionRows(agent)).toHaveLength(0);
    await ctx.fns.session.appendMessage({id:agent.id,message:{role:'tool',tool_call_id:'pending',content:'done'}});
    await ctx.fns.session.syncAgentState({agent});
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(true);
    expect(agent.messages.at(-2).role).toBe('tool');
});

test('fork inherits a visible snapshot once but an earlier fork gets a fresh baseline', async () => {
    const {ctx, agent, dir} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'fork rules');
    await ctx.fns.workspaceInstructions.sync({agent});
    const full = await ctx.fns.session.fork({id:agent.id});
    await ctx.fns.session.syncAgentState({agent:full});
    expect((await ctx.fns.workspaceInstructions.sync({agent:full})).appended).toBe(false);
    const early = await ctx.fns.session.fork({id:agent.id,offset:1});
    await ctx.fns.session.syncAgentState({agent:early});
    expect((await ctx.fns.workspaceInstructions.sync({agent:early})).appended).toBe(true);
    expect(instructionRows(early)).toHaveLength(1);
});

test('compaction which removes the exact baseline causes reinjection, not stale hash suppression', async () => {
    const {ctx, agent, dir} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'compact rules');
    await ctx.fns.workspaceInstructions.sync({agent});
    const original = ctx.state.registry.agent.contextProjection;
    ctx.state.registry.agent.contextProjection = async (c: any,s: any,opts: any) => {
        const p = await original(c,s,opts);
        return {...p,messages:p.messages.filter((m: any)=>m.message_type!=='world_state')};
    };
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(true);
    expect(instructionRows(agent)).toHaveLength(2);
    ctx.state.registry.agent.contextProjection = original;
    expect((await ctx.fns.workspaceInstructions.sync({agent})).appended).toBe(false);
});

test('path cap is durable and explicit; inspector escapes paths and shows statuses without content', async () => {
    const {ctx, agent, dir} = await fixture();
    for (let i=0;i<65;i++) await ctx.fns.workspaceInstructions.touch({agent,path:'d'+i+'/file'});
    expect(agent.scratchpad.workspaceInstructions.paths).toHaveLength(64);
    expect(agent.scratchpad.workspaceInstructions.pathsLimited).toBe(true);
    await writeFile(join(dir,'AGENTS.md'),'private file-body marker');
    await ctx.fns.workspaceInstructions.sync({agent});
    expect(instructionRows(agent).at(-1).content).toContain('64 most recently');
    const html = await ctx.fns.workspaceInstructions.settingsHtml({agentId:agent.id});
    expect(html).toContain('AGENTS.md'); expect(html).toContain('loaded');
    expect(html).not.toContain('private file-body marker');
    const reloaded = await ctx.fns.session.load({id:agent.id});
    expect(reloaded.scratchpad.workspaceInstructions.paths).toHaveLength(64);
});

test('loader failure warns without leaking exception contents or retaining previous instructions', async () => {
    const {ctx,agent,dir} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'former-rules');
    await ctx.fns.workspaceInstructions.sync({agent});
    ctx.state.registry.workspaceInstructions.load = () => {throw new Error('sensitive exception content');};
    await ctx.fns.workspaceInstructions.sync({agent});
    const row = instructionRows(agent).at(-1).content;
    expect(row).toContain('Instruction discovery failed');
    expect(row).not.toContain('sensitive exception content');
    expect(row).not.toContain('former-rules');
});

test('workspace changes during projection cannot append old content or overwrite new tracked paths', async () => {
    const {ctx,agent,dir,root} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'old-project-private-guidance');
    const other = join(root,'other'); await mkdir(other);
    const original = ctx.state.registry.agent.contextProjection;
    ctx.state.registry.agent.contextProjection = async (c: any,s: any,o: any) => {
        const p = await original(c,s,o);
        await ctx.fns.workspace.set({agent,dir:other});
        await ctx.fns.workspaceInstructions.touch({agent,path:'new/file'});
        return p;
    };
    expect(await ctx.fns.workspaceInstructions.sync({agent})).toEqual({appended:false,reason:'workspace-changed'});
    expect(instructionRows(agent)).toHaveLength(0);
    expect(agent.scratchpad.workspaceInstructions.paths).toEqual([join(other,'new/file')]);
    expect(agent.scratchpad.workspaceInstructions.key).toBe(JSON.stringify(['',other]));
});

test('workspace changes during append leave old row superseded before the next sample', async () => {
    const {ctx,agent,dir,root} = await fixture();
    await writeFile(join(dir,'AGENTS.md'),'old-append-rules');
    const other = join(root,'other'); await mkdir(other); await writeFile(join(other,'AGENTS.md'),'new-append-rules');
    const original = ctx.state.registry.session.appendMessage;
    let switched = false;
    ctx.state.registry.session.appendMessage = async (c: any,s: any,o: any) => {
        const result = await original(c,s,o);
        if (!switched && o.message.message_type === 'world_state') { switched = true; await ctx.fns.workspace.set({agent,dir:other}); await ctx.fns.workspaceInstructions.touch({agent,path:'new/file'}); }
        return result;
    };
    expect((await ctx.fns.workspaceInstructions.sync({agent})).reason).toBe('workspace-changed');
    expect(agent.scratchpad.workspaceInstructions.paths).toEqual([join(other,'new/file')]);
    expect((await ctx.fns.workspaceInstructions.sync({agent})).reason).toBe('changed');
    expect(instructionRows(agent).at(-1).content).toContain('new-append-rules');
    expect(instructionRows(agent).at(-1).content).not.toContain('old-append-rules');
});

test('a file tool finishing after a workspace switch does not activate the wrong nested path', async () => {
    const {ctx,agent,root} = await fixture();
    const other = join(root,'other'); await mkdir(other);
    ctx.state.registry.tools.read = async () => { await ctx.fns.workspace.set({agent,dir:other}); return 'old file content'; };
    expect((await ctx.fns.tools.call({agent,name:'read',args:{path:'nested/file'}})).isError).toBe(false);
    expect(agent.scratchpad.workspaceInstructions?.paths ?? []).toEqual([]);
});

test('touch rejects NUL and unbounded paths without persistence', async () => {
    const {ctx,agent} = await fixture();
    expect(await ctx.fns.workspaceInstructions.touch({agent,path:'nested/' + String.fromCharCode(0)})).toBe(false);
    expect(await ctx.fns.workspaceInstructions.touch({agent,path:'x'.repeat(4097)})).toBe(false);
    expect(agent.scratchpad.workspaceInstructions).toBeUndefined();
});

test('remote tilde paths use remote HOME, never the server home, and remain bounded to workspace', async () => {
    const {ctx,agent} = await fixture();
    agent.workspaceHost = 'remote'; agent.workspaceDir = '/srv/user/project';
    let request: any;
    ctx.state.registry.remote.exec = async (_c: any,_s: any,o: any) => {request=o;return {stdout:'/srv/user',stderr:'',exitCode:0,timedOut:false,ms:1};};
    expect(await ctx.fns.workspaceInstructions.touch({agent,path:'~/project/nested/file'})).toBe(true);
    expect(agent.scratchpad.workspaceInstructions.paths).toEqual(['/srv/user/project/nested/file']);
    expect(request.command).toBe('printf \'%s\' "$HOME"');
    expect(request.timeout).toBe(5);
    expect(await ctx.fns.workspaceInstructions.touch({agent,path:'~/elsewhere/file'})).toBe(false);
    expect(await ctx.fns.workspaceInstructions.touch({agent,path:'~other/project/file'})).toBe(false);
    ctx.state.registry.remote.exec = async () => ({stdout:'',stderr:'sensitive',exitCode:1,timedOut:false,ms:1});
    expect(await ctx.fns.workspaceInstructions.touch({agent,path:'~/project/other/file'})).toBe(false);
});
