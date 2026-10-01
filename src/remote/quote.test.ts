// Sixteen call sites build remote bash command lines out of this function, so a
// change that looks like a simplification is a command injection. Every case
// below was verified against a real bash before being written down.
import { test, expect } from "bun:test";
import { testCtx } from "../$test";

const ctx = await testCtx();
const quote = (value: string, path?: boolean) => ctx.fns.remote.quote({ value, path });

test("ordinary text is single-quoted, including when empty", () => {
    expect(quote("plain")).toBe("'plain'");
    expect(quote("a b")).toBe("'a b'");
    expect(quote("")).toBe("''");
});

test("shell metacharacters lose their meaning", () => {
    // Inside single quotes bash expands nothing, so these must survive verbatim.
    expect(quote("$(whoami)")).toBe("'$(whoami)'");
    expect(quote("`id`")).toBe("'`id`'");
    expect(quote("a && rm -rf /")).toBe("'a && rm -rf /'");
    expect(quote("a\nb")).toBe("'a\nb'");
});

test("an embedded quote cannot close the quoting and start a command", () => {
    // The one case that actually breaks naive implementations: the payload tries
    // to end the quoted run, inject a command, and reopen it.
    expect(quote("a'; rm -rf /; '")).toBe("'a'\\''; rm -rf /; '\\'''");
});

test("the quoting survives a real bash round trip", async () => {
    // The payload contains the word PWNED as text, so its presence proves
    // nothing. What matters is that bash hands the string back unchanged —
    // printf saw ONE argument and the injected `echo` never ran, which an
    // executed payload would betray by printing PWNED on a line of its own.
    const payload = "a'; echo PWNED; '";
    const out = await Bun.$`bash -c ${"printf %s " + quote(payload)}`.text();
    expect(out).toBe(payload);
    expect(out.split("\n")).toHaveLength(1);
});

test("with path, a leading ~ stays expandable and the rest is still quoted", () => {
    // The remote shell has to expand ~ to the remote home, so it must not be
    // quoted — but nothing after it is trustworthy.
    expect(quote("~", true)).toBe("~");
    expect(quote("~/", true)).toBe("~/");
    expect(quote("~/a b", true)).toBe("~/'a b'");
    expect(quote("~/it's", true)).toBe("~/'it'\\''s'");
});

test("with path, a tilde that is not the home shorthand is quoted whole", () => {
    // `~root` would expand to another user's home, which the caller did not ask
    // for, and an absolute path needs no expansion at all.
    expect(quote("~root/x", true)).toBe("'~root/x'");
    expect(quote("/tmp/x", true)).toBe("'/tmp/x'");
});

test("a path payload cannot escape through the unquoted prefix", async () => {
    // ~ must expand on the remote side, so it is deliberately left bare; the
    // test is that this concession does not let the rest of the value run.
    const out = await Bun.$`bash -c ${"printf %s " + quote("~/'; echo PWNED; '", true)}`.text();
    expect(out.split("\n")).toHaveLength(1);
    expect(out.endsWith("/'; echo PWNED; '")).toBe(true);
    expect(out.startsWith("/")).toBe(true);          // the tilde really did expand
});
