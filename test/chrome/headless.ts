// Headless Chrome for the test environment — never the developer's browser.
//
// testChrome(): one shared headless Chrome for the whole suite on a fixed port
// (TEST_CHROME_PORT, default 59222) with its own profile in .runtime/test-chrome.
// The first worker to need it starts it detached; the others (and later runs)
// just find it answering, like hyper-db-test. Every test ctx gets its address as
// CDP_BROWSER_URL (see src/$test.ts and the test preload), so code that talks to
// "the browser" in a test talks to this one. Returns null when no Chrome is
// installed; the URL then points nowhere so nothing falls back to :9222.
//
// startHeadlessChrome(): a private throwaway instance (temp profile, random
// port) for a test that wants a browser of its own; stop() removes it.

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CANDIDATES = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter(Boolean) as string[];

const FLAGS = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-gpu",
    "--disable-background-networking", "--disable-sync", "--mute-audio"];

/** Where tests reach Chrome when there is none: refused at once, never the developer's :9222. */
export const NO_CHROME_URL = "http://127.0.0.1:1";

const up = (url: string) => fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false);

let shared: Promise<string | null> | undefined;

export function testChrome(): Promise<string | null> {
    return shared ??= (async () => {
        const port = Number(process.env.TEST_CHROME_PORT) || 59222;
        const url = `http://127.0.0.1:${port}`;
        if (await up(url)) return url;
        const bin = CANDIDATES.find(p => existsSync(p));
        if (!bin) return null;
        const profile = resolve(import.meta.dir, "../../.runtime/test-chrome");
        mkdirSync(profile, { recursive: true });
        // Two workers may race here: the loser cannot bind the port and exits;
        // both then see the winner answer.
        const p = Bun.spawn({
            cmd: [bin, ...FLAGS, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
            stdin: "ignore", stdout: "ignore", stderr: "ignore",
        });
        p.unref();
        for (let i = 0; i < 1000; i++) {
            if (await up(url)) return url;
            await Bun.sleep(10);
        }
        return null;
    })();
}

export type HeadlessChrome = { url: string; stop: () => Promise<void> };

export async function startHeadlessChrome(): Promise<HeadlessChrome | null> {
    const bin = CANDIDATES.find(p => existsSync(p));
    if (!bin) return null;
    const profile = mkdtempSync(join(tmpdir(), "hyper-chrome-"));
    const p = Bun.spawn({
        cmd: [bin, ...FLAGS, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"],
        stdout: "ignore", stderr: "ignore",
    });
    const stop = async () => {
        p.kill();
        await Promise.race([p.exited, Bun.sleep(2000)]);
        rmSync(profile, { recursive: true, force: true });
    };
    // Chrome writes the port it picked to <profile>/DevToolsActivePort.
    const portFile = join(profile, "DevToolsActivePort");
    for (let i = 0; i < 500; i++) {
        if (existsSync(portFile)) {
            const port = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
            if (port) {
                const url = `http://127.0.0.1:${port}`;
                if (await up(url)) return { url, stop };
            }
        }
        if (p.exitCode !== null) break;
        await Bun.sleep(10);
    }
    await stop();
    return null;
}
