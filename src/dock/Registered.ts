/** A loaded Dock entry: its definition plus its id (`<module>.<name>`), owner module and declaring file. */
export type Registered = types.dock.Item & { id: string; module: string; rel: string };
