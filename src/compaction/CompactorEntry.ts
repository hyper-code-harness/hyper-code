/** A registered compactor and the file that declared it. */
export type CompactorEntry = { provider: string; module: string; rel: string; compact: types.compaction.Compactor };
