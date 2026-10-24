import { expect, test } from "bun:test";
import { testDatabaseUrl } from "./$test";

test("a unix-socket DATABASE_URL is moved to the test server, never left on the live socket", () => {
    const live = "postgres://hyper:pw@localhost:54412/hyper?path=/tmp/.s.PGSQL.54412";
    const url = new URL(testDatabaseUrl({ DATABASE_URL: live }));
    expect(url.port).toBe("54399");
    expect(url.searchParams.get("path")).toBeNull();
});

test("an explicit TEST_DATABASE_URL pointing at the live server is refused", () => {
    const live = "postgres://hyper:pw@localhost:54412/hyper?path=/tmp/.s.PGSQL.54412";
    expect(() => testDatabaseUrl({ DATABASE_URL: live, TEST_DATABASE_URL: live })).toThrow(/working database/);
    expect(() => testDatabaseUrl({ DATABASE_URL: "postgres://h:p@127.0.0.1:54393/hyper" , TEST_DATABASE_URL: "postgres://h:p@127.0.0.1:54393/x" })).toThrow(/working database/);
    expect(testDatabaseUrl({ DATABASE_URL: live, TEST_DATABASE_URL: "postgres://h:p@127.0.0.1:54399/hyper" })).toContain(":54399/");
});
