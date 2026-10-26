import { describe, test, expect } from "bun:test";
import stop from './stop';

describe('agent.stop', () => {
  test('aborts run and clears next_run_at when clearQueue=true', async () => {
    const calls: any[] = [];
    const agent: any = {
      id: 'a1',
      abortController: { abort(reason: any) { calls.push(['abort', reason]); } },
      isStreaming: true,
    };
    const ctx: any = {
      fns: {
        procs: {
          db: { run: (opts: { sql: string; params?: any[] }) => { calls.push(['db.run', opts.sql.replace(/\s+/g, ' ').trim(), opts.params]); return { changes: 1, lastInsertRowid: 0 }; } },
        },
        session: {
          appendEventWithHtml: (opts: { id: string; type: string; payload: any }) => calls.push(['appendEvent', opts.id, opts.type, opts.payload]),
          syncAgentState: () => {},
          mutateScratchpad: () => {},
        },
        events: { refreshAgentMeta: () => {} },
        tools: { runs: () => [], abortRun: () => ({ aborted: false }) },
      },
    };
    const res = await stop(ctx, null, { agent, clearQueue: true });
    expect(res.ok).toBe(true);
    expect(calls[0]).toEqual(['abort', 'stopped_by_user']);
    expect(calls[1][0]).toBe('db.run');
    expect(calls[1][1]).toMatch(/UPDATE agents .*run_state = 'idle'.*next_run_at = NULL/);
    // A stop is not an error: a quiet "stopped" event, and last_error is cleared.
    expect(calls[1][1]).toMatch(/last_error = NULL/);
    expect(calls[2]).toEqual(['appendEvent', 'a1', 'stopped', { clearQueue: true }]);
  });

  test('without clearQueue keeps next_run_at', async () => {
    const calls: any[] = [];
    const agent: any = {
      id: 'a1',
      abortController: { abort() {} },
      isStreaming: true,
    };
    const ctx: any = {
      fns: {
        procs: {
          db: { run: (opts: { sql: string; params?: any[] }) => { calls.push(opts.sql.replace(/\s+/g, ' ').trim()); return { changes: 1, lastInsertRowid: 0 }; } },
        },
        session: { appendEventWithHtml: () => {}, syncAgentState: () => {}, mutateScratchpad: () => {} },
        events: { refreshAgentMeta: () => {} },
        tools: { runs: () => [], abortRun: () => ({ aborted: false }) },
      },
    };
    await stop(ctx, null, { agent, clearQueue: false });
    expect(calls[0]).toMatch(/next_run_at = next_run_at/);
  });

  test('pauses an active plan and stops its timer', async () => {
    let committed: any;
    const agent: any = {
      id: 'a1', abortController: null, isStreaming: true,
      scratchpad: { plan: { tasks: [{ id: 'x', status: 'active', activeSince: 1000, elapsedMs: 50 }] } },
    };
    const ctx: any = { fns: {
      procs: { db: { run: () => ({ changes: 1 }) } },
      session: {
        mutateScratchpad: async ({ mutate }: any) => {
          const scratchpad = structuredClone(agent.scratchpad);
          await mutate(scratchpad, 1600);
          committed = scratchpad;
          return { scratchpad };
        },
        appendEventWithHtml: () => {}, syncAgentState: () => {},
      },
      events: { refreshAgentMeta: () => {} },
      tools: { runs: () => [], abortRun: () => ({ aborted: false }) },
    } };
    await stop(ctx, null, { agent });
    expect(committed.plan.pausedAt).toBe(1600);
    expect(committed.plan.tasks[0]).toMatchObject({ activeSince: null, elapsedMs: 650 });
  });

  // The bug: stop aborted the run but left the tool call itself running. A bash command
  // started before the press went on to its own end, and the chat kept spinning on work
  // the person had already stopped.
  test('aborts every tool call this agent has in flight', async () => {
    const aborted: string[] = [];
    const agent: any = { id: 'a1', abortController: null, isStreaming: true };
    const ctx: any = { fns: {
      procs: { db: { run: () => ({ changes: 1 }) } },
      session: { appendEventWithHtml: () => {}, syncAgentState: () => {}, mutateScratchpad: () => {} },
      events: { refreshAgentMeta: () => {} },
      tools: {
        runs: ({ agentId }: any) => agentId === 'a1' ? [{ id: 'r1' }, { id: 'r2' }] : [],
        abortRun: ({ id }: any) => { aborted.push(id); return { aborted: true }; },
      },
    } };
    await stop(ctx, null, { agent });
    expect(aborted).toEqual(['r1', 'r2']);
  });

});
