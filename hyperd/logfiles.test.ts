import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dailyAppender, dayFiles, dayOf, journal, readDayFile, rollIfNewDay, tidy } from "./logfiles.ts";

const DAY = 24 * 3600_000;
const at = (s: string) => new Date(s).getTime();
const touch = (p: string, ms: number) => utimesSync(p, ms / 1000, ms / 1000);

test("a log is rolled to its day file on the first write of a new day, not before", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperd-logs-"));
    const log = join(dir, "out.log");
    let now = at("2026-10-28T23:59:00");
    const append = dailyAppender(log, () => now);
    append("late evening\n");
    touch(log, now);
    expect(readdirSync(dir)).toEqual(["out.log"]);
    now = at("2026-10-29T00:00:05");
    append("after midnight\n");
    expect(readFileSync(join(dir, "out.2026-10-28.log"), "utf8")).toBe("late evening\n");
    expect(readFileSync(log, "utf8")).toBe("after midnight\n");
});

test("a file left from an earlier day is rolled when its writer starts; the same day twice gets a number", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperd-logs-"));
    const log = join(dir, "out.log");
    writeFileSync(join(dir, "out.2026-10-27.log"), "first\n");
    writeFileSync(log, "second\n");
    touch(log, at("2026-10-27T12:00:00"));
    expect(rollIfNewDay(log, at("2026-10-28T09:00:00"))).toBe(join(dir, "out.2026-10-27-1.log"));
    expect(rollIfNewDay(join(dir, "missing.log"))).toBeNull();
    expect(dayFiles(dir, "out.log").map((f) => f.name)).toEqual(["out.2026-10-27.log", "out.2026-10-27-1.log"]);
});

test("tidy gzips settled day files, keeps them readable, and removes the expired ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperd-logs-"));
    const now = Date.now();
    const old = dayOf(now - 20 * DAY), recent = dayOf(now - 2 * DAY);
    writeFileSync(join(dir, `out.${old}.log`), "ancient\n");
    writeFileSync(join(dir, `out.${recent}.log`), "recent line\n");
    writeFileSync(join(dir, "out.log"), "today\n");
    // ctime cannot be set back, so settleMs: 0 stands for "set aside long enough ago"
    const r = await tidy(dir, { now, keepDays: 14, settleMs: 0 });
    expect(r.removed).toEqual([`out.${old}.log`]);
    expect(r.gzipped).toEqual([`out.${recent}.log`]);
    expect(existsSync(join(dir, `out.${recent}.log.gz`))).toBe(true);
    expect(readDayFile(join(dir, `out.${recent}.log.gz`)).toString()).toBe("recent line\n");
    expect(readFileSync(join(dir, "out.log"), "utf8")).toBe("today\n");
    // a just-rolled file is left alone until it settles
    writeFileSync(join(dir, `out.${dayOf(now - DAY)}.log`), "y\n");
    expect((await tidy(dir, { now, settleMs: 60_000 })).gzipped).toEqual([]);
});

test("the event journal keeps seq across a day roll and reads back across it", () => {
    const dir = mkdtempSync(join(tmpdir(), "hyperd-logs-"));
    const path = join(dir, "events.ndjson");
    let now = at("2026-10-28T23:00:00");
    const j = journal(path, () => now);
    j.append({ seq: 1 }); j.append({ seq: 2 });
    touch(path, now);
    now = at("2026-10-29T08:00:00");
    j.append({ seq: 3 });
    expect(existsSync(join(dir, "events.2026-10-28.ndjson"))).toBe(true);
    expect(j.read(0, 10).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(j.read(2, 10).map((e) => e.seq)).toEqual([3]);
    expect(journal(path, () => now).lastSeq()).toBe(3);
});
