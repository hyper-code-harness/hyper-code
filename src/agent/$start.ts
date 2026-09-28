// agent module boot: rehydrate persisted agents into ctx.state.agent, then
// start the single in-process worker that drains agent runs. Listed in
// package.json procs.prod after procs/migrate so the schema is ready.
//
// AGENT_WORKER=off keeps the worker from starting — for a test instance on a copy of a real
// database, where queued agents must not wake up and act (call models, tools, send messages).
/** Initializes the agent runtime when the namespace starts. */
export default async function (ctx: Context, _session: Session | null, _config?: unknown) {
    const rehydrated = await ctx.fns.session.loadAll({});
    ctx.fns.procs.log.info({ event: "agent.rehydrated", msg: `${rehydrated.loaded} agent(s)` });
    if (ctx.env.AGENT_WORKER === "off") {
        ctx.fns.procs.log.info({ event: "agent.worker.disabled", msg: "agent worker disabled by AGENT_WORKER=off" });
        return;
    }
    queueMicrotask(() => {
        ctx.fns.agent.workerLoop({}).catch((e: any) => console.error("[workerLoop] crashed:", e?.message ?? e));
    });
}
