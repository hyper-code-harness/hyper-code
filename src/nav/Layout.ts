// The global menu layout, stored as JSON in the `nav.layout` setting — for the whole instance (scope global,
// env HYPER_NAV) and per person (scope user). The person's copy wins as a whole.
export type Layout = {
    /** Format version; bump when the shape changes. @default 1 */
    version?: number;
    /** Tabs in this order. `home` / `plugins` override the built-in tabs' fields; any other id with a title is the
     *  person's own tab. Built-in tabs not listed come first. Plugin widgets placed nowhere land on `plugins`. */
    tabs?: Array<{ id: string } & Partial<types.nav.Tab>>;
    /** Tab ids not shown. */
    hidden?: string[];
    /** Plugin widget ids not collected on the built-in plugins tab (the person removed them there). */
    widgetsHidden?: string[];
    /** Search source ids never asked. */
    searchHidden?: string[];
};
