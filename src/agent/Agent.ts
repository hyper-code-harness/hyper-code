export type Agent = {
    id: string;
    model: string;
    title: string;
    /** Durable preference for model-side reasoning intensity. */
    reasoningEffort?: types.llm.ReasoningEffort;
    workspaceDir: string;
    systemPrompt: string;
    /** Narrow this agent to a subset of the declared tools (wire names). Unset
     *  = every loaded tool. What is excluded here never reaches the prompt or
     *  the provider's tool list, so it costs no prefix tokens either. */
    tools?: string[];
    messages: any[];                        // synchronized runtime view of DB-backed transcript
    events: any[];                          // synchronized runtime view of DB-backed event trace
    cursors: Record<string, number>;
    subscribers: Set<(ev: any, signal?: AbortSignal) => void>;
    waiters: Array<() => void>;
    isStreaming: boolean;
    abortController: AbortController | null;
    scratchpad: Record<string, any>;
    parentId?: string | null;
    statusLine?: string;
    /** Selects inherited global text, a local replacement, or no user status line. */
    statusLineMode?: "global" | "custom" | "off";
    /** Controls where the agent is listed; it is not an access-control boundary. */
    visibility?: "nav" | "team" | "hidden";
    statusLineEvery?: number;
    forkOffset?: number | null;
    sleepContext?: Record<string, any> | null;
    currentJobId?: string | null;
    /** Inject compact hybrid-search function candidates for new user prompts. */
    functionRagEnabled?: boolean;
    /** Rerank retrieved function candidates with Jev before injecting them. */
    /** Independently gate runtime-function retrieval before search; new agents default off. */
    functionRagGateEnabled?: boolean;
    jevRerankEnabled?: boolean;
    goal?: Record<string, any> | null;
    drainPromise?: Promise<any> | null;
    wakeAt?: number | null;
    wakeReason?: string | null;
};
