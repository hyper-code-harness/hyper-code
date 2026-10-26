import { expect, test } from "bun:test";
import widget from "./$widget_today";

test("gcal Today widget lists upcoming events of today, all-day first by start, past ones dropped", async () => {
    const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const now = new Date().getHours();
    const events = [
        { id: "a", calendarId: "c", summary: "Done already", start: at(0), end: new Date(Date.now() - 60_000).toISOString(), allDay: false },
        { id: "b", calendarId: "c", summary: "Holiday", start: at(0), end: at(23), allDay: true },
        { id: "c", calendarId: "c", summary: "Call", start: new Date(Date.now() + 3_600_000).toISOString(), end: new Date(Date.now() + 7_200_000).toISOString(), allDay: false, meetLink: "https://meet", htmlLink: "https://calendar.google.com/x" },
    ];
    let range: any;
    const ctx: any = { fns: { gcal: { agenda: async (o: any) => { range = o; return { events, calendars: [], errors: [] }; } } } };
    const out: any = await widget.render(ctx, null, { size: "M", config: { days: 1 } });
    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBe(86_400_000);
    expect(out.items.map((i: any) => i.label)).toEqual(["Holiday", "Call"]);
    expect(out.items[1]).toMatchObject({ href: "https://calendar.google.com/x", icon: "ph-video-camera" });
    expect(widget.ttl).toBeGreaterThan(0);
    void now;
    const empty: any = await widget.render({ fns: { gcal: { agenda: async () => ({ events: [], calendars: [], errors: [] }) } } } as any, null, { size: "S", config: {} });
    expect(empty.items).toMatchObject([{ label: "Nothing more today", href: "/gcal/" }]);
});
