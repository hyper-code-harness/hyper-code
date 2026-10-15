// The Dock layout, stored as JSON in the `dock.layout` setting — for the whole instance (scope global,
// env HYPER_DOCK) and per person (scope user). The person's copy wins as a whole.
export type Layout = {
    /** Entry ids shown first in the top zone, in this order; listing an id here moves it to the top. */
    top?: string[];
    /** Entry ids shown first in the bottom zone, in this order. */
    bottom?: string[];
    /** Entry ids not shown at all. */
    hidden?: string[];
};
