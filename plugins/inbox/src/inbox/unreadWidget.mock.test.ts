import { expect, test } from "bun:test";
import widget from "./$widget_unread";

test("inbox widget counts unread received mail and lists the newest, fewer on a small tile", async () => {
    const mail = [1, 2, 3].map(n => ({ id: `m${n}`, subject: `S${n}`, text: "", from: `bot${n}@x`, verified: n !== 3, readAt: n === 2 ? 1 : null }));
    let asked: any;
    const ctx: any = { fns: { inbox: { list: async (o: any) => { asked = o; return mail; } } } };
    const out: any = await widget.render(ctx, null, { size: "S" });
    expect(asked).toMatchObject({ direction: "in" });
    expect(out.items.map((i: any) => [i.label, i.href, i.icon, i.hint])).toEqual([["2 unread", "/inbox", "ph-tray", undefined], ["S1", "/inbox/m1", "ph-envelope", "bot1"], ["S3", "/inbox/m3", "ph-warning", "bot3"]]);
});
