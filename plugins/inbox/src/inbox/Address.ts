/** Relay directory entry of an address: principal, kind and active keys (one per device / Hyper instance). */
export type Address = { addr: string; principal: string; kind: "person" | "hyper"; local: string | null; host: string | null; keys: { npub: string; device: string; label: string | null; createdAt: number }[] };
