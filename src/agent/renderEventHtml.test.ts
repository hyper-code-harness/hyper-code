import { describe, test, expect } from "bun:test";
import renderEventHtmlFn from "./renderEventHtml";
import toolMeta from "./toolMeta";
import toolLang from "./toolLang";
import highlightResult from "./highlightResult";
import renderEditArgs from "./renderEditArgs";

// The renderer asks the registry how a tool presents itself, so the stub ctx
// carries the real fn rather than a fake one — the icon/label/subject table is
// exactly what these assertions are about.
const ctx = { fns: {
  agent: {
    toolMeta: (opts: any) => toolMeta(ctx, null, opts),
    toolLang: (opts: any) => toolLang(ctx, null, opts),
    highlightResult: (opts: any) => highlightResult(ctx, null, opts),
    renderEditArgs: (opts: any) => renderEditArgs(ctx, null, opts),
  },
  markdown: { highlight: async ({ code }: any) => `<pre>${String(code)}</pre>` },
  procs: { ui: {
    escape: ({ text }: any) => String(text),
    button: (o: any) => `<button type="${o.type ?? 'button'}" class="${o.appearance === 'plain' ? o.class ?? '' : `ui-button ui-button--${o.size ?? 'sm'} ui-button--${o.tone ?? 'default'}`}"${o.post ? ` hx-post="${o.post}"` : ''}${o.swap ? ` hx-swap="${o.swap}"` : ''}${o.vals ? ` hx-vals='${JSON.stringify(o.vals)}'` : ''}${o.title ? ` title="${o.title}"` : ''}${o.attrs ? Object.entries(o.attrs).map(([name, value]) => ` ${name}="${String(value)}"`).join('') : ''}>${o.html ?? o.label ?? ''}</button>`,
  } },
  ui: { popup: (opts: any) => `<button type="button" hx-popup="${opts.method}" hx-popup-params='${JSON.stringify(opts.params)}' ${opts.attrs}>${opts.html}</button>` },
} } as unknown as Context;
const renderEventHtml = (c: any, event: any, opts: { agentId?: string } = {}) =>
    renderEventHtmlFn(c, null, { event, agentId: opts.agentId });

describe("agent.renderEventHtml", () => {
  test("renders a tool call as a card that names what it acted on", async () => {
    // The card says the verb and the SUBJECT — "eval 1 + 1", not "args 63c".
    const evalHtml = await renderEventHtml(ctx, { type: "tool_call", name: "eval", argsHtml: "<pre>a</pre>", resultHtml: "<pre>b</pre>", result: "b", args: { code: "1 + 1" }, isError: false, ts: Date.now(), idx: 7 }, { agentId: "a" });
    expect(evalHtml).toContain('<button type="button"');
    expect(evalHtml).not.toContain('<details');
    expect(evalHtml).toContain('data-title="eval 1 + 1"');
    expect(evalHtml).toContain("1 + 1");
    expect(evalHtml).toContain("ph-brackets-curly");
    expect(evalHtml).toContain('hx-popup="agent.toolDetails"');
    expect(evalHtml).toContain('hx-popup-params=');
    expect(evalHtml).not.toContain('hx-post');
    expect(evalHtml).not.toContain('hx-target');
    expect(evalHtml).not.toContain('tool-label');
    expect(evalHtml).not.toContain('tool-subject');
    expect(evalHtml).not.toContain('tool-size');
    expect(evalHtml).not.toContain('tool-status');
    // Arguments and result alike are fetched from /agent/:id/tool/:idx only
    // when the compact button is clicked.
    expect(evalHtml).not.toContain("<pre>b</pre>");

    // A write names its path like everything else; it is a circle too.
    const writeHtml = await renderEventHtml(ctx, { type: "tool_call", name: "write", argsHtml: "<pre>x</pre>", resultHtml: "<pre>ok</pre>", result: "ok", args: { path: "src/foo.ts", content: "x" }, isError: false, ts: Date.now(), idx: 8 }, { agentId: "a" });
    expect(writeHtml).toContain("src/foo.ts");
    expect(writeHtml).not.toContain("<details");
    expect(writeHtml).toContain('hx-popup="agent.toolDetails"');
    expect(writeHtml).toContain("tool-tucked");

    expect(writeHtml).toContain("tool-tucked");
    expect(writeHtml).not.toContain("border-gray-200 bg-white");

    const editHtml = await renderEventHtml(ctx, { type: "tool_call", name: "edit", args: { path: "src/foo.ts", edits: [] }, result: "ok", isError: false, ts: Date.now() });
    expect(editHtml).toContain("tool-tucked");

    const readHtml = await renderEventHtml(ctx, { type: "tool_call", name: "read", args: { path: "src/foo.ts" }, result: "x", isError: false, ts: Date.now() });
    expect(readHtml).toContain("tool-tucked");
    // A failure is a red circle — the detail is in the toast that does not fade.
    const failed = await renderEventHtml(ctx, { type: "tool_call", name: "bash", args: { command: "false" }, result: "[exit 1]", argsHtml: "", resultHtml: "", isError: true, ts: Date.now() });
    expect(failed).toContain("tool-tucked");
    expect(failed).toContain('data-error="1"');

    // An old call arrives already tucked, so reloading a long transcript does
    // not flash a hundred expanded cards.
    // Age no longer matters: a call is a circle the moment it lands.
    for (const ts of [Date.now(), Date.now() - 60_000]) {
        const c = await renderEventHtml(ctx, { type: "tool_call", name: "read", args: { path: "a.ts" }, result: "x", argsHtml: "", resultHtml: "", isError: false, ts });
        expect(c).toContain("tool-tucked");
        expect(c).not.toContain("<details");
    }

    // Errors stay open too so the user sees the failure body without a click.
    const errHtml = await renderEventHtml(ctx, { type: "tool_call", name: "eval", argsHtml: "<pre>x</pre>", resultHtml: "<pre>err</pre>", result: "err", args: { code: "x" }, isError: true });
    expect(errHtml).toContain("tool-tucked");
    expect(errHtml).toContain('data-error="1"');

    // Unknown / legacy event names fall through to the raw name.
    const legacy = await renderEventHtml(ctx, { type: "tool_call", name: "evalCode", argsHtml: "<pre>a</pre>", resultHtml: "<pre>b</pre>", result: "b", args: { code: "a" }, isError: false });
    expect(legacy).toContain("evalCode");
  });

  test("renders plan task injections as visible system cards", async () => {
    const html = await renderEventHtml(ctx, { type: "plan_activation", taskId: "t1", title: "Build it", instructions: "Use the API" });
    expect(html).toContain("Plan task injected");
    expect(html).toContain("Build it");
    expect(html).toContain("Use the API");
    expect(html).toContain("ph-list-checks");
  });


  test("renders assistant as left bubble with htmx delete buttons when agentId given", async () => {
    const html = await renderEventHtml(ctx, { type: "assistant", html: "<p>ok</p>", usage: { prompt_tokens: 1234, total_tokens: 1300 }, messageIdx: 7 }, { agentId: 'a1' });
    expect(html).toContain("justify-start");
    expect(html).toContain("assistant chat-glass");
    expect(html).toContain("prose prose-sm max-w-none");
    expect(html).toContain(`hx-post="/agent/a1/messages/delete"`);
    expect(html).toContain(`"idx":"7"`);
    expect(html).toContain(`hx-confirm="delete this message?"`);
  });

  test("puts time in the final text line instead of a separate row", async () => {
    const ts = new Date(2025, 0, 1, 12, 34).getTime();
    const user = await renderEventHtml(ctx, { type: "user", text: "one line", ts, messageIdx: 1 });
    expect(user).toContain('one line<span class="inline-block ml-2');
    expect(user).not.toContain('class="mt-1 text-[10px]');

    const assistant = await renderEventHtml(ctx, { type: "assistant", html: "<p>one line</p>", text: "one line", ts, messageIdx: 2 });
    expect(assistant).toMatch(/one line<span class="inline-block ml-2[^>]*>[^<]+<\/span><\/p>/);
    expect(assistant).not.toContain('class="mt-1 text-[10px]');
  });


  test("assistant: balanced rendered html passes through verbatim", async () => {
    const balanced = '<p>line 1</p><p>line 2</p>';
    const out = await renderEventHtml(ctx, { type: "assistant", html: balanced, text: 'line 1\nline 2', messageIdx: 1 });
    expect(out).toContain(balanced);
    expect(out).not.toContain('<pre class="text-xs whitespace-pre-wrap');
  });

  test("assistant: unbalanced rendered html falls back to escaped <pre> (one bad bubble cannot break the page)", async () => {
    // This is the exact pattern that broke the chat page: model emitted
    // `prose.§bash` mid-line + Python heredoc content; markdown.render
    // produced an extra </div>. Without the balance-check fallback, every
    // bubble below this one renders inside the broken div tree.
    const broken = '<p>good prefix</p><div class="x">stuff</div></div>';
    const text = 'Plain prose with <<\'PY\'\nfrom pathlib import Path\nPY\n';
    const out = await renderEventHtml(ctx, { type: "assistant", html: broken, text, messageIdx: 42 });
    // The original broken html must NOT appear in the output.
    expect(out).not.toContain(broken);
    // Instead, plain text wrapped in <pre> with HTML-escaped content.
    expect(out).toContain('<pre class="text-xs whitespace-pre-wrap');
    expect(out).toContain('&lt;&lt;&#39;PY&#39;');
    expect(out).toContain('from pathlib import Path');
  });

  test("assistant: missing html falls back to escaped <p> (existing behaviour)", async () => {
    const out = await renderEventHtml(ctx, { type: "assistant", text: 'hello & world', messageIdx: 0 });
    expect(out).toContain('<p>hello &amp; world</p>');
  });

  test("renders user with compact icon delete controls", async () => {
    const html = await renderEventHtml(ctx, { type: "user", text: "hi", messageIdx: 3 }, { agentId: 'a1' });
    expect(html).toContain("justify-end");
    expect(html).toContain("chat-glass-primary rounded-xl");
    expect(html).not.toContain("bg-gray-900");
    expect(html).toContain(`"mode":"one"`);
    expect(html).toContain(`"mode":"from"`);
    expect(html).toContain(`hx-confirm="delete this and everything after?"`);
    expect(html).toContain('title="Delete message"');
    expect(html).toContain('title="Delete from here"');
    expect(html).toContain('ph-trash');
    expect(html).toContain('ph-arrow-line-down');
    expect(html).not.toContain('>delete</button>');
    expect(html).not.toContain('>from here</button>');
  });

  test("omits delete controls when agentId not provided (e.g. test stubs)", async () => {
    const html = await renderEventHtml(ctx, { type: "user", text: "hi", messageIdx: 3 });
    expect(html).not.toContain("hx-post");
  });
  test("renders the applied status line marker with hover text", async () => {
    const html = await renderEventHtml(ctx, {
      type: "assistant", text: "done", html: "<p>done</p>", messageIdx: 4, ts: Date.now(),
      instructionIndicators: { statusLine: "be <brief>" },
    });
    expect(html).toContain('aria-label="status line applied"');
    expect(html).toContain("Status line: be &lt;brief&gt;");
  });


  test("renders goal check as a labelled message card", async () => {
    const html = await renderEventHtml(ctx, { type: "goal_check", status: "continue", reason: "not verified", nextStep: "run tests", iteration: 1, maxIterations: 3 });
    expect(html).toContain("Goal check: continue · 1/3");
    expect(html).toContain("not verified");
    expect(html).toContain("run tests");
    expect(html).toContain("ph-target");
  });


  test("renders exhausted goal budget as a terminal orange card", async () => {
    const html = await renderEventHtml(ctx, { type: "goal_check", status: "limit_reached", reason: "limit reached", iteration: 2, maxIterations: 2 });
    expect(html).toContain("Goal check: limit_reached · 2/2");
    expect(html).toContain("ph-stop-circle");
    expect(html).toContain("badge");
  });

  test("renders conditional wake as a compact card with collapsible result", async () => {
    const html = await renderEventHtml(ctx, { type: "wake_up", watchId: "w1", watchStatus: "ready", reason: "Email arrived", result: { subject: "Hello", snippet: "Body" } });
    expect(html).toContain("Condition met");
    expect(html).toContain(">watch</span>");
    expect(html).toContain("<summary");
    expect(html).toContain("Details");
    expect(html).toContain('&quot;subject&quot;: &quot;Hello&quot;');
    expect(html).not.toContain("Wake condition met:");
  });


});

describe("agent.renderEventHtml — errors", () => {
    test("an error renders nothing in the chat: it is a toast and a status bar", async () => {
        const html = await renderEventHtml(ctx, { type: "error", error: "codex 400: invalid schema" });
        expect(html).toBe("");
    });
});
