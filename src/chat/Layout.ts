// The chat.layout setting: order and hiding of header parts by id (`<module>.<name>`). Listed ids come first
// in the listed order, the rest follow by their own order; unknown ids are skipped.
export type Layout = {
    badges?: string[];
    buttons?: string[];
    cards?: string[];
    hidden?: string[];
};
