/**
 * Lists recurring prompt schedules attached to one agent
 *
 * Return durable cron tasks whose target is agent.injectScheduledPrompt and whose args reference the requested agent. Use to render and manage Agent schedules.
 * @param opts.agentId Agent whose schedules are listed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose schedules are listed. */
        agentId: string;
    },
): Promise<any[]> {
    const id=String(opts.agentId??"").trim();if(!id)return[];const tasks=await ctx.fns.cron.list({limit:500});return tasks.filter((task:any)=>{const args=typeof task.args==="string"?JSON.parse(task.args):task.args;return task.fn==="agent.injectScheduledPrompt"&&String(args?.agentId??"")===id;});
}
