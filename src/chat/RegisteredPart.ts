/** A loaded chat header part: its definition plus id (`<module>.<name>`), kind, owner module and declaring file. */
export type RegisteredPart = (types.chat.Badge | types.chat.Button | types.chat.Card) & {
    id: string;
    kind: "badge" | "button" | "card";
    module: string;
    rel: string;
};
