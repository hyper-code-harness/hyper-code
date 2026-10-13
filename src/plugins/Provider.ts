/** Trusted mounted runtime declaration of an inert plugin source. */
export type Provider = { apiVersion: 1; label: string; description: string; icon?: string; configurationHref?: string; handlers: { search: string; materialize?: string } };
