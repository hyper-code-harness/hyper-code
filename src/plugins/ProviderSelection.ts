/** Provider-owned opaque identity pinned to an immutable revision; never executable. */
export type ProviderSelection = { provider: string; name: string; revision: string; source: Record<string, string> };
