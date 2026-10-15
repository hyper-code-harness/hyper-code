// A private headless Chrome for tests: own temp profile, own debugging port, no
// window, never the developer's browser. startHeadlessChrome() returns its CDP
// base URL (http://127.0.0.1:<port>) or null when no Chrome is installed —
// tests skip then. stop() kills it and removes the profile.
//
// Chrome binary: CHROME_BIN, else the usual macOS / Linux locations.

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CANDIDATES = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
].filter(Boolean) as string[];

export type HeadlessChrome = { url: string; stop: () => Promise<void> };

export async function startHeadlessChrome(): Promise<HeadlessChrome | null> {
    const bin = CANDIDATES.find(p => existsSync(p));
    if (!bin) return null;
    const profile = mkdtempSync(join(tmpdir(), "hyper-chrome-"));
    const p = Bun.spawn({
        cmd: [bin, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
            "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-gpu", "about:blank"],
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
                if (await fetch(`${url}/json/version`).then(r => r.ok, () => false)) return { url, stop };
            }
        }
        if (p.exitCode !== null) break;
        await Bun.sleep(10);
    }
    await stop();
    return null;
}
