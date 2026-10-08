/** One stored message. direction in = received (verified or quarantined), out = sent by an agent of this Hyper. */
export type Message = {
    id: string; direction: "in" | "out"; agentId: string | null; from: string; to: string[]; subject: string | null; text: string;
    thread: string | null; hop: number; verified: boolean; reason: string | null; senderPrincipal: string | null;
    createdAt: number; receivedAt: number; deliveredAt: number | null; readAt: number | null;
};
