// bun test preload (bunfig.toml [test].preload). Marks which ctxs a test makes (they are closed and the test
// database reset after it, see $test.ts), and at the end of the process closes every pool still open so idle
// connections don't pile up toward max_connections. `.entry.ts` keeps this out of the fn scanner.
import { afterAll, afterEach, beforeEach } from "bun:test";
import { endTest } from "./$test";
import { closeTestDatabases } from "./_testDb.entry";
import { testChrome, NO_CHROME_URL } from "../test/chrome/headless";

// Code that builds its own ctx or reads process.env must not reach the developer's Chrome either.
process.env.CDP_BROWSER_URL = (await testChrome()) ?? NO_CHROME_URL;

beforeEach(() => { (globalThis as any).__hyperInTest = true; });

afterEach(async () => {
    (globalThis as any).__hyperInTest = false;
    await endTest();
});

afterAll(async () => {
    const pools: Set<any> | undefined = (globalThis as any).__hyperTestPools;
    if (pools) for (const sql of [...pools]) {
        pools.delete(sql);
        try { await sql.close(); } catch { /* already closed */ }
    }
    await closeTestDatabases();
});
