/** Canvas state of one agent: whether the canvas is shown and how wide the chat column beside it is. */
export type View = {
    /** Agent the canvas belongs to. */
    agentId: string;
    /** The canvas is shown left of the chat. */
    open: boolean;
    /** Width in px of the chat column while the canvas is open. */
    chatWidth: number;
    /** The chat is folded into a floating strip over the canvas (only while the canvas is open). */
    chatCollapsed: boolean;
    /** Item shown in the canvas; null for an empty canvas. */
    activeItemId: number | null;
};
