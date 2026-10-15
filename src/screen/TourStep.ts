// One step of a tour: a sentence and, at most, one thing to do. The shape is
// played one at a time by screen.step in the browser.
export type TourStep = types.screen.Descriptor & {
    say?: string;
    open?: string | ({ url?: string } & types.screen.Descriptor);
    click?: types.screen.Descriptor;
    point?: types.screen.Descriptor;
    fill?: { form: string; values: Record<string, string | number | boolean> };
    submit?: string;
};
