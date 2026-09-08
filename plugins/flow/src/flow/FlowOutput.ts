/** Declaration output. Preview must return gaps; effects describe action results, not need closure. */
export type FlowOutput = {/** Trusted HTML replacement for the one submitted card, never the page shell. */ html?: string; gaps?: types.flow.Gap[]; effects?: Array<{reference: string; label?: string}>; explanation?: string};
