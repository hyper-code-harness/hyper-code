// The Dock layout, stored as JSON in the `dock.layout` setting — for the whole instance (scope global,
// env HYPER_DOCK) and per person (scope user). The person's copy wins as a whole.
export type Layout = {
    /** Entry ids shown first in the top zone, in this order; listing an id here moves it to the top. */
    top?: string[];
    /** Entry ids shown first in the bottom zone, in this order. */
    bottom?: string[];
    /** Entry ids not shown at all. */
    hidden?: string[];
    /** Pages the person pinned to the Dock, as local hrefs (`/news`); each becomes entry `page:<href>`.
     *  Pinned chats are kept per person in user_agent_state (shared with the menu and mobile) and appear as `agent:<id>`. */
    pins?: string[];
};
