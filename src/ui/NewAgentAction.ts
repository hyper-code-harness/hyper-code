// One quick action offered next to "New agent" (answer to the ui.newAgentActions point).
export type NewAgentAction = {
    /** Stable id, unique across plugins (`support:new`). */
    id: string;
    /** Button / row text. */
    label: string;
    /** Phosphor icon class such as `ph-headset`; a plus when omitted. */
    icon?: string;
    /** Where it goes: a local path or an http(s) URL. Exclusive with fn. */
    href?: string;
    /** Runtime function (`module.fn`) opened in the app popup. Exclusive with href. */
    fn?: string;
};
