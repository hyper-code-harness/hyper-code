/** A stored input row as kinds see it. */
export type Row = {
    id: string;
    agentId: string;
    kind: string;
    state: "open" | "processing" | "submitted" | "cancelled";
    title: string;
    message: string;
    spec: Record<string, any>;
    result: Record<string, any> | null;
    error: string | null;
    answeredBy: string | null;
    createdAt: number;
    updatedAt: number;
};
