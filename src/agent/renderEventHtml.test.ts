import { describe, test, expect } from "bun:test";
import renderEventHtmlFn from "./renderEventHtml";
import toolMeta from "./toolMeta";
import toolLang from "./toolLang";
import highlightResult from "./highlightResult";
import renderEditArgs from "./renderEditArgs";
import renderToolRun from "./renderToolRun";
import toolCallCell from "./toolCallCell";
import runningToolCall from "./runningToolCall";
import { renderCtx } from "../ui/testRender.entry";

const escHtml = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]!));
// w.code highlights through markdown.highlight; the stub escapes like shiki does.
const kit = await renderCtx({ "markdown.highlight": async (_c: any, _s: any, { code }: any) => `<pre>${escHtml(String(code))}</pre>` });

// The renderer asks the registry how a tool presents itself, so the stub ctx
// carries the real fn rather than a fake one — the icon/label/subject table is
// exactly what these assertions are about.
const ctx = { fns: {
  agent: {
    toolMeta: (opts: any) => toolMeta(ctx, null, opts),
    toolLang: (opts: any) => toolLang(ctx, null, opts),
    highlightResult: (opts: any) => highlightResult(ctx, null, opts),
    renderEditArgs: (opts: any) => renderEditArgs(ctx, null, opts),
    renderToolRun: (opts: any) => renderToolRun(ctx, null, opts),
    toolCallCell: (opts: any) => toolCallCell(ctx, null, opts),
    runningToolCall: (opts: any) => runningToolCall(ctx, null, opts),
  },
  tools: { runs: () => [] },
  markdown: { highlight: async ({ code }: any) => `<pre>${String(code)}</pre>` },
  procs: { ui: {
    escape: ({ text }: any) => String(text),
    button: (o: any) => `<button type="${o.type ?? 'button'}" class="${o.appearance === 'plain' ? o.class ?? '' : `ui-button ui-button--${o.size ?? 'sm'} ui-button--${o.tone ?? 'default'}`}"${o.post ? ` hx-post="${o.post}"` : ''}${o.swap ? ` hx-swap="${o.swap}"` : ''}${o.vals ? ` hx-vals='${JSON.stringify(o.vals)}'` : ''}${o.title ? ` title="${o.title}"` : ''}${o.attrs ? Object.entries(o.attrs).map(([name, value]) => ` ${name}="${String(value)}"`).join('') : ''}>${o.html ?? o.label ?? ''}</button>`,
  } }, w: kit.fns.w,
  ui: { popup: (opts: any) => `<button type="button" hx-popup="${opts.method}" hx-popup-params='${JSON.stringify(opts.params)}' ${opts.attrs}>${opts.html}</button>` },
} } as unknown as Context;
const renderEventHtml = (c: any, event: any, opts: { agentId?: string } = {}) =>
    renderEventHtmlFn(c, null, { event, agentId: opts.agentId });

describe("agent.renderEventHtml", () => {
  test("renders Telegram attachment events as incoming message cards", async () => {
    const html = await renderEventHtml(ctx, {
      type: "attachment_event",
      source: "telegram",
      eventType: "message.new",
      payload: { chatTitle: "TODO: work", senderName: "Nikolai", text: "что ты делаешь?", chatId: "-42", messageId: 7 },
    });
    expect(html).toContain("TODO: work · new message");
    expect(html).toContain("Nikolai");
    expect(html).toContain("что ты делаешь?");
    expect(html).toContain("ph-telegram-logo");
    expect(html).not.toContain("Scheduled wake-up");
  });


  test("renders a tool call as a w.toolGroup cell that names what it acted on", async () => {
    // The cell says the verb and the SUBJECT — "eval 1 + 1", not "args 63c".
    const evalHtml = await renderEventHtml(ctx, { type: "tool_call", name: "eval", result: "b", args: { code: "1 + 1" }, isError: false, ts: Date.now(), idx: 7 }, { agentId: "a" });
    expect(evalHtml).toContain('id="tools-7"');
    expect(evalHtml).toContain('class="w-tool-group"');
    expect(evalHtml).toContain('class="w-tool"');
    expect(evalHtml).toContain('title="eval 1 + 1"');
    expect(evalHtml).toContain("ph-brackets-curly");
    expect(evalHtml).toContain('hx-popup="agent.toolDetails"');
    expect(evalHtml).toContain('&quot;idx&quot;:7');
    expect(evalHtml).not.toContain("hx-post");
    // Arguments and result are fetched only when the cell is clicked.
    expect(evalHtml).not.toContain(">b<");

    const writeHtml = await renderEventHtml(ctx, { type: "tool_call", name: "write", args: { path: "src/foo.ts", content: "x" }, result: "ok", isError: false, idx: 8 }, { agentId: "a" });
    expect(writeHtml).toContain("src/foo.ts");
    expect(writeHtml).not.toContain("<details");

    // A failure is a red cell — the detail is one click away.
    const failed = await renderEventHtml(ctx, { type: "tool_call", name: "bash", args: { command: "false" }, result: "[exit 1]", isError: true });
    expect(failed).toContain('data-tone="danger"');

    // Unknown / legacy event names fall through to the raw name.
    const legacy = await renderEventHtml(ctx, { type: "tool_call", name: "evalCode", args: { code: "a" }, isError: false });
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
    expect(html).toContain('<div id="m-7" class="w-msg" data-role="agent">');
    expect(html).toContain("w-msg-text w-markdown");
    expect(html).toContain(`hx-post="/agent/a1/messages/delete"`);
    expect(html).toContain(`&quot;idx&quot;:&quot;7&quot;`);
    expect(html).toContain(`hx-confirm="delete this message?"`);
  });

  test("puts time in the final text line instead of a separate row", async () => {
    const ts = new Date(2025, 0, 1, 12, 34).getTime();
    const user = await renderEventHtml(ctx, { type: "user", text: "one line", ts, messageIdx: 1 });
    expect(user).toMatch(/<div class="w-msg-text" data-copy-text>one line<span class="w-msg-meta" data-no-copy><time[^>]*>[^<]+<\/time><\/span><\/div>/);

    const assistant = await renderEventHtml(ctx, { type: "assistant", html: "<p>one line</p>", text: "one line", ts, messageIdx: 2 });
    expect(assistant).toMatch(/<p>one line<span class="w-msg-meta" data-no-copy><time[^>]*>[^<]+<\/time><\/span><\/p>/);
  });


  test("assistant: balanced rendered html passes through verbatim", async () => {
    const balanced = '<p>line 1</p><p>line 2</p>';
    const out = await renderEventHtml(ctx, { type: "assistant", html: balanced, text: 'line 1\nline 2', messageIdx: 1 });
    expect(out).toContain(balanced);
    expect(out).not.toContain('class="w-code"');
  });

  // Balance of the whole rendered bubble: every <div> opened must be closed,
  // otherwise the bubble's markup leaked into the rest of the page.
  const divBalance = (html: string) => (html.match(/<div[\s>]/g) ?? []).length - (html.match(/<\/div>/g) ?? []).length;

  test("assistant: a stray close tag is dropped by the spec parser (one bad bubble cannot break the page)", async () => {
    // The pattern that once broke the chat page: markdown.render produced an
    // extra </div>, closing the bubble early.
    const broken = '<p>good prefix</p><div class="x">stuff</div></div>';
    const out = await renderEventHtml(ctx, { type: "assistant", html: broken, text: 'x', messageIdx: 42 });
    expect(out).toContain('<p>good prefix</p><div class="x">stuff</div>');
    expect(divBalance(out)).toBe(0);
  });

  test("assistant: unclosed elements are closed inside the bubble", async () => {
    const out = await renderEventHtml(ctx, { type: "assistant", html: '<p>a</p><div><span><strong>x', text: 'x', messageIdx: 1 });
    expect(out).toContain('<div><span><strong>x</strong></span></div>');
    expect(divBalance(out)).toBe(0);
  });

  test("assistant: a tag without '>' falls back to escaped <pre> instead of eating the text", async () => {
    // Real model output: `<strong Почему это лучше:` — the browser turned the prose
    // into attributes and left <strong> open for the whole chat below.
    const html = '<p>ok</p>\n<strong Почему это лучше: blah</p>\n<p>after</p>';
    const text = 'ok\n<strong Почему это лучше: blah';
    const out = await renderEventHtml(ctx, { type: "assistant", html, text, messageIdx: 2 });
    expect(out).toContain('class="w-code"');
    expect(out).toContain('&lt;strong Почему это лучше');
    expect(out).not.toContain('<strong Почему');
    expect(divBalance(out)).toBe(0);
  });

  test("assistant: an unterminated comment falls back to <pre>", async () => {
    const out = await renderEventHtml(ctx, { type: "assistant", html: '<p>a</p><!-- open', text: 'a', messageIdx: 3 });
    expect(out).toContain('class="w-code"');
  });

  test("assistant: ordinary markdown output passes through unchanged", async () => {
    const html = '<h2>T</h2><p><strong class="a">b</strong> <a href="/y">l</a> <code>a&lt;b</code><br></p><pre><code class="language-ts">const x = a &lt; b;</code></pre><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><details><summary>s</summary>x</details>';
    const out = await renderEventHtml(ctx, { type: "assistant", html, text: 'x', messageIdx: 4 });
    expect(out).toContain(html);
    expect(out).not.toContain('class="w-code"');
  });

  test("assistant: missing html falls back to escaped <p> (existing behaviour)", async () => {
    const out = await renderEventHtml(ctx, { type: "assistant", text: 'hello & world', messageIdx: 0 });
    expect(out).toContain('<p>hello &amp; world</p>');
  });

  test("renders user with compact icon delete controls", async () => {
    const html = await renderEventHtml(ctx, { type: "user", text: "hi", messageIdx: 3 }, { agentId: 'a1' });
    expect(html).toContain('<div id="m-3" class="w-msg" data-role="user">');
    expect(html).toContain(`&quot;mode&quot;:&quot;one&quot;`);
    expect(html).toContain(`&quot;mode&quot;:&quot;from&quot;`);
    expect(html).toContain(`hx-confirm="delete this and everything after?"`);
    expect(html).toContain('data-context-of="#m-3"');
    expect(html).toContain('>Delete message<');
    expect(html).toContain('>Delete from here<');
    expect(html).toContain('ph-trash');
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
