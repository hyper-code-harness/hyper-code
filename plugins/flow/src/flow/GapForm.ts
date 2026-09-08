/** Minimal trusted declaration-owned form. Client sends values, never a function name or schema. */
export type GapForm = {
    /** Opaque action identity, interpreted only by the declaring rule. */
    id: string;
    /** Explicit confirmation label. */
    label: string;
    fields: Array<{
        name: string;
        type: 'datetime-local';
        label: string;
        timezone: string;
        /** Optional editable current wall time, never a scheduled time. */
        value?: string;
        min?: string;
    } | {
        name: string;
        type: 'text';
        label: string;
        value?: string;
        /** Optional bounded comment; empty is accepted. */
        maxLength: number;
    }>;
};
