import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testCtx } from '../$test';

test('run delivers initial guidance before sampling and nested guidance after the complete tool batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hyper-instruction-run-'));
    try {
        await mkdir(join(dir,'.git')); await mkdir(join(dir,'nested')); await mkdir(join(dir,'home'));
        await writeFile(join(dir,'AGENTS.md'),'root-policy-unique');
        await writeFile(join(dir,'nested/CLAUDE.md'),'nested-policy-unique');
        await writeFile(join(dir,'nested/file.txt'),'file');
        const ctx: any = await testCtx();
        delete ctx.state.procs.hooks.handlers['agent.promptAugment'];
        const loader = ctx.state.registry.workspaceInstructions.load;
        ctx.state.registry.workspaceInstructions.load = (c: any,s: any,o: any) => loader(c,s,{...o,globalDir:join(dir,'home')});
        const agent = await ctx.fns.agent.start({model:'mock:test',workspaceDir:dir});
        agent.statusLineMode = 'off';
        agent.scratchpad.mockLLM = {turns:[{toolCalls:[{name:'read',args:{path:'nested/file.txt'}},{name:'read',args:{path:'AGENTS.md'}}]},{text:'finished'}]};
        await ctx.fns.session.save({agent});
        const sample = ctx.state.registry.llm.streamMock;
        const seen: string[] = [];
        ctx.state.registry.llm.streamMock = async (c: any,s: any,o: any) => {
            seen.push(o.agent.messages.filter((m: any)=>m.message_type==='world_state').map((m: any)=>m.content).join('\n'));
            return sample(c,s,o);
        };
        await ctx.fns.agent.run({agent,userText:'work'});
        expect(seen).toHaveLength(2);
        expect(seen[0]).toContain('root-policy-unique');
        expect(seen[0]).not.toContain('nested-policy-unique');
        expect(seen[1]).toContain('nested-policy-unique');
        const messages = await ctx.fns.session.getMessages({id:agent.id});
        expect(messages.map((m: any)=>m.role)).toEqual(['user','user','assistant','tool','tool','user','assistant']);
        expect(messages[1].message_type).toBe('world_state');
        expect(messages[5].message_type).toBe('world_state');
        expect(messages[3].tool_call_id).toBe(messages[2].tool_calls[0].id);
        expect(messages[4].tool_call_id).toBe(messages[2].tool_calls[1].id);
    } finally { await rm(dir,{recursive:true,force:true}); }
});
