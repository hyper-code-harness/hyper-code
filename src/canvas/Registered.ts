/** A loaded canvas kind: its definition plus its name, owner module, declaring file and prompt hint. */
export type Registered = types.canvas.Kind & { name: string; module: string; rel: string; hint?: string | ((ctx: Context) => string | Promise<string>) };
