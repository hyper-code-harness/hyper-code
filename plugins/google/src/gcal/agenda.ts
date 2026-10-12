// Merged multi-account, multi-calendar event feed for the calendar page and canvas tab.
const EVENT_COLORS: Record<string, string> = { "1": "#7986cb", "2": "#33b679", "3": "#8e24aa", "4": "#e67c73", "5": "#f6bf26", "6": "#f4511e", "7": "#039be5", "8": "#616161", "9": "#3f51b5", "10": "#0b8043", "11": "#d50000" };
// Zoom, Meet, Teams or Webex join links pasted into the location or description (no conferenceData).
const VIDEO = /https?:\/\/[\w.-]*(zoom\.us|zoom\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com)\/[^\s"'<>)\]]*/i;
const videoLink = (text?: string) => text ? text.replace(/&amp;/g, "&").match(VIDEO)?.[0] : undefined;
const calCache = new Map<string, { at: number; list: any[] }>();

/**
 * Lists events of every visible calendar in every authorized Google account (or the given ones) for a time
 * range, merged and sorted, each with its calendar name, colour and account.
 * Use to show a full personal schedule (the /gcal page and the gcal.calendar canvas tab read it); use
 * gcal.events for one calendar of one account.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Range start, ISO date or datetime. */
    from: string;
    /** Range end (exclusive), ISO date or datetime. */
    to: string;
    /** Accounts to read; defaults to every authorized account. */
    accounts?: string[];
    /** Include calendars hidden in the Google UI (selected=false). @default false */
    includeHidden?: boolean;
}): Promise<{
    events: { id: string; calendarId: string; calendar: string; account: string; color: string; summary: string; start: string; end: string; allDay: boolean; location?: string; description?: string; htmlLink?: string; meetLink?: string; organizer?: string; responseStatus?: string; attendees?: { email: string; name?: string; responseStatus?: string; organizer?: boolean }[] }[];
    calendars: { id: string; account: string; name: string; color: string; primary: boolean; owner: boolean }[];
    errors: { account: string; calendar?: string; error: string }[];
}> {
    const accounts = opts.accounts?.length ? opts.accounts : await ctx.fns.google.accounts({});
    const timeMin = new Date(opts.from).toISOString(), timeMax = new Date(opts.to).toISOString();
    const errors: { account: string; calendar?: string; error: string }[] = [];
    const calendars: { id: string; account: string; name: string; color: string; primary: boolean; owner: boolean }[] = [];
    const events: any[] = [];
    await Promise.all(accounts.map(async (account: string) => {
        let list: any[];
        const hit = calCache.get(account);
        try {
            if (hit && Date.now() - hit.at < 600_000) list = hit.list;
            else { list = await ctx.fns.gcal.calendars({ account }); calCache.set(account, { at: Date.now(), list }); }
        } catch (e: any) { errors.push({ account, error: String(e?.message ?? e) }); return; }
        const shown = list.filter((c: any) => opts.includeHidden || c.selected !== false || c.primary);
        await Promise.all(shown.map(async (c: any) => {
            const color = c.backgroundColor || "#4285f4";
            calendars.push({ id: c.id, account, name: c.primary ? account : c.summary, color, primary: !!c.primary, owner: c.accessRole === "owner" });
            try {
                let pageToken: string | undefined;
                do {
                    const r = await ctx.fns.gcal.api({ account, path: `/calendars/${encodeURIComponent(c.id)}/events`, query: { timeMin, timeMax, singleEvents: true, orderBy: "startTime", maxResults: 2500, pageToken } });
                    for (const e of r.items ?? []) {
                        if (e.status === "cancelled") continue;
                        const self = e.attendees?.find((a: any) => a.self);
                        if (self?.responseStatus === "declined") continue;
                        events.push({
                            id: e.id, calendarId: c.id, calendar: c.primary ? account : c.summary, account,
                            color: (e.colorId && EVENT_COLORS[e.colorId]) || color,
                            summary: e.summary || "(без названия)", start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date,
                            allDay: !!e.start?.date, location: e.location, description: e.description, htmlLink: e.htmlLink,
                            meetLink: e.hangoutLink || e.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri || videoLink(e.location) || videoLink(e.description),
                            organizer: e.organizer?.displayName || e.organizer?.email, responseStatus: self?.responseStatus,
                            attendees: e.attendees?.map((a: any) => ({ email: a.email, name: a.displayName, responseStatus: a.responseStatus, ...(a.organizer ? { organizer: true } : {}) })),
                        });
                    }
                    pageToken = r.nextPageToken;
                } while (pageToken);
            } catch (e: any) { errors.push({ account, calendar: c.summary, error: String(e?.message ?? e) }); }
        }));
    }));
    // The same meeting appears in several accounts' calendars: keep one copy (prefer a primary calendar).
    const seen = new Map<string, any>();
    for (const e of events) {
        const k = `${e.summary}|${e.start}|${e.end}`;
        const prev = seen.get(k);
        if (!prev || (!calendars.find(c => c.id === prev.calendarId && c.account === prev.account)?.primary && calendars.find(c => c.id === e.calendarId && c.account === e.account)?.primary)) seen.set(k, e);
    }
    const out = [...seen.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
    calendars.sort((a, b) => Number(b.primary) - Number(a.primary) || a.account.localeCompare(b.account) || a.name.localeCompare(b.name));
    return { events: out, calendars, errors };
}
