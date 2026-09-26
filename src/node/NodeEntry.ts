/** A Hyper node this instance relays through (client side). */
export type NodeEntry = {
    name: string;
    url: string;
    enabled: boolean;
    catalog: Array<{ id: string; api: "anthropic" | "responses" | "openai"; provider: string; account: string; kind: "subscription" | "api"; via?: string }> | null;
    catalogAt: number | null;
    usage: Array<{ provider: string; account: string; usedPercent: number | null; resetsAt: number | null; planType: string | null; parkedAgents: number }> | null;
    usageAt: number | null;
    lastError: string | null;
};
