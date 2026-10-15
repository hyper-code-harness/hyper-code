// What every chat header part receives: the agent the chat belongs to, its parent when it is a fork, and how
// many messages the fork inherited. Built once per header render (chat.buildRenderContext), so parts do not repeat these reads.
export type RenderContext = {
    agent: types.agent.Agent;
    parent: types.agent.Agent | null;
    inheritedCount: number;
};
