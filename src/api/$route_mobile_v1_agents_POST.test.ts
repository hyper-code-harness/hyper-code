import { expect, test } from "bun:test";
import route from "./$route_mobile_v1_agents_POST";

test("native API creates an agent through existing creation logic", async () => {
    let values: any;
    const ctx: any = { fns: { agent: { createFromValues: async (opts: any) => { values = opts; return { agent: { id: "xy", title: "Mobile", model: "test:m", workspaceDir: "/tmp/work" } }; } } } };
    const req = new Request("http://localhost/api/mobile/v1/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Mobile", workspaceDir: "", projectId: "p", model: "test:m", systemPrompt: "Be concise", systemPromptName: "lean" }) });
    const response = await route(ctx, null, { req, params: {} });
    expect(response.status).toBe(201);
    expect(values).toMatchObject({ title: "Mobile", workspaceDir: "", projectId: "p", model: "test:m", systemPrompt: "Be concise", systemPromptName: "lean", systemPromptCore: "" });
    expect(await response.json()).toMatchObject({ agent: { id: "xy" } });
});
