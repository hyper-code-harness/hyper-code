/** JSON source of truth for a small ordered interaction. Reusable fragments are plain arrays of Scenario['steps'][number]. No execution or protocol verification is implied. */
export type Scenario = {
    /** Optional globally unique scenario ID, up to 128 characters. */
    id?: string;
    /** Optional visible and accessible diagram heading, up to 300 characters. */
    title?: string;
    /** Ordered actors, at most 30; IDs are globally unique and nonblank, up to 128 characters. Labels are XML text up to 300 characters. */
    actors: Array<{ id: string; label: string }>;
    /** Ordered steps, at most 200 including phases; at most eight nested phase levels. Empty scenarios and phases are supported. */
    steps: Array<
        | { type: 'message'; id: string; from: string; to: string; label: string; kind: 'request' | 'reply' | 'send' | 'redirect' }
        | { type: 'action'; id: string; actor: string; label: string }
        | { type: 'phase'; id: string; title: string; steps: Scenario['steps'] }
    >;
};
