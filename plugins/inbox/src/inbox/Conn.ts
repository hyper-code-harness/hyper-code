/** A connection to the relay as this Hyper's key. sk is the secret key (hex): internal, never print, log or return it to a model. */
export type Conn = { base: string; sk: string; npub: string; fetch?: (req: Request) => Promise<Response>; cache?: Map<string, unknown> };
