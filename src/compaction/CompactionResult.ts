/** What a compactor hands back: the message that replaces the compacted prefix. */
export type CompactionResult = {
    /** Message stored in the hidden child; replayed before the verbatim tail. */
    message: { role: "user"; content: string; message_type: string };
    /** Short human-readable description for events and the Meta panel. */
    summary: string;
};
