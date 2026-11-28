/** One logical invocation. Mutable references never cross the network. */
export type Scope = {
    id: string;
    agentId: string | null;
    clientId: string | null;
    clientName: string | null;
    requestedModel: string | null;
    source: "local" | "node";
    operation: "call" | "stream" | "compact" | "relay";
    remote: boolean;
    startedAt: number;
    finishedAt: number | null;
    status: "pending" | "success" | "error" | "cancelled";
    active: number;
    pendingAttempts?: Set<types.llmUsage.Attempt>;
    lastAttemptId?: string;
    lastAttemptStatus?: "success" | "error" | "cancelled";
    returned: boolean;
    failed: boolean;
    cancelled: boolean;
    finalized: boolean;
    persisted: boolean;
    broken: boolean;
};
