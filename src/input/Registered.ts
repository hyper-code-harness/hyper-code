/** A registered kind: the module's definition plus where it came from. */
export type Registered = types.input.Kind & { name: string; module: string; rel: string; hint?: string };
