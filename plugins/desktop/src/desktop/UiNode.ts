/** One Accessibility element in a desktop.snapshot tree; `id` is a path usable with desktop.press / desktop.setValue until the UI changes. */
export type UiNode = {
    id: string;
    role?: string;
    subrole?: string;
    title?: string;
    value?: string;
    desc?: string;
    help?: string;
    placeholder?: string;
    identifier?: string;
    /** Screen coordinates in points, top-left origin. */
    frame?: { x: number; y: number; w: number; h: number };
    disabled?: boolean;
    focused?: boolean;
    actions?: string[];
    truncated?: boolean;
    children?: UiNode[];
};
