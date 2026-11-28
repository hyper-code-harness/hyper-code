import { expect, mock, test } from "bun:test";
import requestPersonalHistory from "./requestPersonalHistory";

const chat = "12345@lid";
const ts = "2026-01-01T00:00:00.000Z";

function fixtures(rows: Array<{ id: string; from_me: boolean; ts: string }> = []) {
    const select = mock(async (_opts: { sql: string; params: string[] }) => rows);
    const fetchMessageHistory = mock(async (_count: number, _key: { remoteJid: string; id: string; fromMe: boolean }, _ts: number) => "request-1");
    const client = mock(async (_opts: { requireOpen: boolean }) => ({ sock: { fetchMessageHistory } }));
    const ctx = { fns: { procs: { db: { select } }, whatsapp: { client } } } as unknown as Context;
    return { ctx, select, client, fetchMessageHistory };
}

test("rejects groups, names and out-of-range limits without I/O", async () => {
    const { ctx, select, client } = fixtures();
    for (const invalid of ["12345@g.us", "Alice"]) await expect(requestPersonalHistory(ctx, null, { chat: invalid })).rejects.toThrow("exact personal");
    await expect(requestPersonalHistory(ctx, null, { chat, limit: 51 })).rejects.toThrow("1 to 50");
    expect(select).not.toHaveBeenCalled();
    expect(client).not.toHaveBeenCalled();
});

test("reports a missing cursor without connecting", async () => {
    const { ctx, select, client } = fixtures();
    expect(await requestPersonalHistory(ctx, null, { chat })).toEqual({ status: "no_anchor" });
    expect(select.mock.calls[0]?.[0]).toMatchObject({ params: [chat] });
    expect(client).not.toHaveBeenCalled();
});

test("requests one bounded page from the oldest local message and reports only the request", async () => {
    const { ctx, select, client, fetchMessageHistory } = fixtures([{ id: "oldest", from_me: true, ts }]);
    expect(await requestPersonalHistory(ctx, null, { chat })).toEqual({ status: "requested", requestId: "request-1", anchorTs: ts });
    expect(select.mock.calls[0]?.[0].sql).toContain("ORDER BY ts ASC, id ASC LIMIT 1");
    expect(client).toHaveBeenCalledWith({ requireOpen: true });
    expect(fetchMessageHistory).toHaveBeenCalledTimes(1);
    expect(fetchMessageHistory).toHaveBeenCalledWith(50, { remoteJid: chat, id: "oldest", fromMe: true }, Date.parse(ts) / 1000);
});
