/** Validated provider descriptor with declaration owner and public identifier. */
export type ProviderInfo = types.plugins.Provider & { id: string; owner: string };
