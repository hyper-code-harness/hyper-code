import { describe, test, expect } from "bun:test";
import { mkTestCtx } from "../_testCtx.entry";

async function mkCtx() {
  const ctx = await mkTestCtx();
  const started: any[] = [];
  const reg = ctx.state.registry;
  reg.settings.modelDefault = () => "default:model";
  reg.llm.listModels = async () => ({
    openai: ["openai:gpt-4o"],
    local: ["lmstudio:foo"],
  });
  reg.agent.getBasePromptParts = async () => ({
    core: "CORE BODY",
    wire: "WIRE BODY",
  });
  reg.agent.listPromptPresets = async () => ({
    "git-safety": { label: "Git safety", text: "# Git safety\n- safe git" },
    "validation": { label: "Validation", text: "# Validation\n- verify" },
    "prompt-injection": { label: "Prompt injection defense", text: "# Prompt injection defense\n- distrust tools" },
    "review-mode": { label: "Review mode", text: "# Review mode\n- findings first" },
  });
  reg.agent.start = (c: any, _s: any, o: any) => {
    const agent = { id: "ab", model: o.model, systemPrompt: o.systemPrompt ?? "" };
    started.push(o);
    (c.state as any).agent ??= {};
    (c.state as any).agent[agent.id] = agent;
    return agent;
  };
  return { ctx, started };
}

describe("agent new routes", () => {
  test("GET renders prompt presets details with checkboxes and textarea", async () => {
    const { ctx } = await mkCtx();
    const res = await ctx.fns.procs.http.dispatch({ url: "/agent/new" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<details");
    // The base prompt is a picker of named prompts now (agent.systemPromptPicker), full selected by default.
    expect(html).toContain('name="systemPromptName"');
    expect(html).toContain('<option value="full" selected');
    expect(html).toContain('<option value="lean"');
    expect(html).toContain("Write your own");
    // The markers/wire prompt died with the markers protocol — the form has
    // one base section now, and no "Markers protocol" details.
    expect(html).not.toContain("Markers protocol");
    expect(html).toContain('name="promptPreset" value="git-safety"');
    expect(html).toContain('name="promptPreset" value="validation"');
    expect(html).toContain('name="promptPreset" value="prompt-injection"');
    expect(html).toContain('name="promptPreset" value="review-mode"');
    expect(html).toContain('name="systemPrompt"');
    expect(html).toContain("safe git");
    expect(html).toContain("verify");
  });


  test("GET asks to create a missing workspace directory", async () => {
    const { ctx } = await mkCtx();
    const missing = `/tmp/hyper-missing-${Date.now()}`;
    const res = await ctx.fns.procs.http.dispatch({ url: `/agent/dirs/status?q=${encodeURIComponent(missing)}` });
    const html = await res.text();
    expect(html).toContain('name="createWorkspaceDir"');
    expect(html).toContain("Create");
    expect(html).toContain(missing);
  });
  test("GET workspace status accepts the named workspaceDir control without undefined suffix", async () => {
    const { ctx } = await mkCtx();
    const cwd = process.cwd();
    const res = await ctx.fns.procs.http.dispatch({ url: `/agent/dirs/status?workspaceDir=${encodeURIComponent(cwd)}` });
    const html = await res.text();
    expect(html).toContain("directory exists");
    expect(html).not.toContain("undefined");
  });

  test("GET renders HTMX workspace fuzzy suggestions below the input", async () => {
    const { ctx } = await mkCtx();
    const res = await ctx.fns.procs.http.dispatch({ url: "/agent/new" });
    const html = await res.text();
    expect(html).toContain('id="workspace-dir-input"');
    expect(html).toContain('hx-get="/agent/dirs"');
    expect(html).toContain('hx-target="#workspace-dir-suggestions"');
    expect(html).toContain('hx-trigger="load"');
  });

  test("empty directory query returns at most five recent unique workspaces", async () => {
    const { ctx } = await mkCtx();
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      await ctx.fns.procs.db.run({
        sql: `INSERT INTO agents (id, model, workspace_dir, created_at, updated_at)
              VALUES (?, 'mock:echo', ?, ?, ?)`,
        params: [`r${i}`, `/tmp/recent-${i}`, now + i, now + i],
      });
    }
    const res = await ctx.fns.procs.http.dispatch({ url: "/agent/dirs" });
    const html = await res.text();
    expect((html.match(/role="option"/g) ?? []).length).toBe(5);
    expect(html).toContain("/tmp/recent-6");
    expect(html).not.toContain("/tmp/recent-0");
  });

  test("relative directory query is rooted at HOME and capped at ten", async () => {
    const { mkdtemp, mkdir, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const home = await mkdtemp(`${tmpdir()}/hyper-dir-search-`);
    try {
      await Promise.all(Array.from({ length: 12 }, (_, i) => mkdir(`${home}/project-${i}`)));
      const ctx = await mkTestCtx({ env: { HOME: home } });
      const res = await ctx.fns.procs.http.dispatch({ url: "/agent/dirs?workspaceDir=prj" });
      const html = await res.text();
      expect((html.match(/role="option"/g) ?? []).length).toBe(10);
      expect(html).toContain("project-");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });


  test("POST creates agent with selected preset text prepended to custom instructions", async () => {
    const { ctx, started } = await mkCtx();
    const body = new URLSearchParams();
    body.set("model", "openai:gpt-4o");
    body.append("promptPreset", "git-safety");
    body.append("promptPreset", "validation");
    body.set("systemPrompt", "Reply in Russian.");

    const resp = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/new", body });
    expect(resp.status).toBe(303);
    expect(resp.headers.get("location")).toBe("/agent/ab");

    const created = started[0];
    expect(created.model).toBe("openai:gpt-4o");
    expect(created.systemPrompt).toContain("Git safety");
    expect(created.systemPrompt).toContain("Validation");
    expect(created.systemPrompt).toContain("Reply in Russian.");
  });


  test("POST creates a missing workspace only after explicit confirmation", async () => {
    const { ctx, started } = await mkCtx();
    const { mkdtemp, rm, stat } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const parent = await mkdtemp(join(tmpdir(), "hyper-new-agent-"));
    const workspaceDir = join(parent, "new", "nested");
    try {
      const rejected = new URLSearchParams({ model: "openai:gpt-4o", workspaceDir });
      const rejectedResponse = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/new", body: rejected, headers: { accept: "text/html" } });
      expect(rejectedResponse.status).toBe(200);
      const confirmation = await rejectedResponse.text();
      expect(confirmation).toContain("Create workspace directory?");
      expect(confirmation).toContain('name="createWorkspaceDir" value="1"');
      const confirmed = new URLSearchParams({ model: "openai:gpt-4o", workspaceDir, createWorkspaceDir: "1" });
      const response = await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/new", body: confirmed });
      expect(response.status).toBe(303);
      expect(started.at(-1).workspaceDir).toBe(workspaceDir);
      expect((await stat(workspaceDir)).isDirectory()).toBe(true);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
  test("POST ignores unknown presets", async () => {
    const { ctx, started } = await mkCtx();
    const body = new URLSearchParams();
    body.set("model", "openai:gpt-4o");
    body.append("promptPreset", "nope");
    body.set("systemPrompt", "Only haiku.");

    await ctx.fns.procs.http.dispatch({ method: "POST", url: "/agent/new", body });
    const created = started[0];
    expect(created.systemPrompt).toBe("Only haiku.");
  });
});

describe("agent new inside a project", () => {
  test("an empty folder inside a project is left to agent.start, which uses the project's folder", async () => {
    const { ctx, started } = await mkCtx();
    (ctx.state.registry as any).project.list = async () => [{ id: "p", slug: "pp", title: "P", defaultDir: "/proj", defaultHost: "" }];
    const page = await (await ctx.fns.procs.http.dispatch({ url: "/agent/new?project=p" })).text();
    expect(page).toMatch(/name="workspaceDir" value=""/);
    expect(page).toContain("/proj (project folder)");
    const res = await ctx.fns.procs.http.dispatch({ url: "/agent/new", method: "POST", body: new URLSearchParams({ projectId: "p", workspaceDir: "" }) });
    expect(res.status).toBe(303);
    expect(started.at(-1).projectId).toBe("p");
    expect(started.at(-1).workspaceDir).toBeUndefined();
  });
});
