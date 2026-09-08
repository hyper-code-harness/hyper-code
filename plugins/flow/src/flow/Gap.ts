/** A current unmet need derived from facts, never a persisted queue row. */
export type Gap = {
    id: string;
    revision: string;
    /** Optional compact card presentation returned by the rule, not inferred by the UI. */
    display?: {title:string;subtitle?:string;status?:string;detail?:string};
    summary: string;
    for?: string;
    /** Single available action; absent means informational only. */
    will?: string;
    /** Form returned by this gap's trusted declaration; separate from legacy will action. */
    form?: types.flow.GapForm;
    facts?: Record<string, string | number | boolean | null>;
};
