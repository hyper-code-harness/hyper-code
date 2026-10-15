// Where a loaded menu extension came from: its id (`<module>.<name>`, bare `<name>` in the nav module),
// owner module and declaring file. The registries hold `types.nav.Widget & Registered` and so on.
export type Registered = { id: string; module: string; rel: string };
