/** Immutable tool-result identity; resolved through agent.readResult, never as a user-supplied path. */
export type ResultRef = {
    version: 1;
    id: string;
    ownerAgentId: string;
    bytes: number;
    sha256: string;
    kind: string;
};
