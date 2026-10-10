// What the JSX factory returns. A box around markup, not a plain string, for
// one reason: a child that is already a drawing must be inserted as is, while a
// child that is a value a human passed in must be escaped. Telling them apart
// by type is reliable; guessing by looking at the text is not.

export type Node = {
    /** The element rendered as SVG markup. */
    markup: string;
};
