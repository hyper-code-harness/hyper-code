// Size of a widget tile in the menu grid (4 columns, rows of ~10rem): S = 1×1, M = 2×1, L = 2×2,
// wide = 4×1, tall = 1 column × the whole height (a long list such as recent chats).
// On a narrow screen every tile takes the full width and its natural height.
export type Size = "S" | "M" | "L" | "wide" | "tall";
