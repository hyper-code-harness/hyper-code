import { expect, test } from "bun:test";
import render from "./agentMetaPanel";
import renderSection from "./agentMetaSection";

const escapeHtml = ({ text }: any) => String(text)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const toggle = (o: any) => `<label><input name="${o.name}" ${o.enabled ? 'checked' : ''}>${o.label ?? ''}</label>`;
const planTaskRow = ({ task }: any) => `<div data-plan-task data-task-id="${escapeHtml({ text: task.id })}" data-task-status="${task.status}"><input name="task_id" value="${escapeHtml({ text: task.id })}"><input name="task_title" value="${escapeHtml({ text: task.title })}"><textarea name="task_instructions">${escapeHtml({ text: task.instructions ?? '' })}</textarea><span>${Math.floor(Number(task.elapsedMs ?? 0) / 1000)}s</span>${task.status === 'pending' ? '<button data-plan-remove></button><button data-plan-move="up"></button>' : ''}</div>`;
const button = (o: any) => `<button type="${o.type ?? (o.name ? 'submit' : 'button')}" class="ui-button ui-button--${o.size ?? 'sm'} ui-button--${o.tone ?? 'default'}"${o.action ? ` data-action="${o.action}"` : ''}${o.get ? ` hx-get="${o.get}"` : ''}${o.post ? ` hx-post="${o.post}"` : ''}${o.target ? ` hx-target="${o.target}"` : ''}${o.swap ? ` hx-swap="${o.swap}"` : ''}>${o.html ?? escapeHtml({ text: o.label ?? '' })}</button>`;
const mkCtx = (extra: any = {}): any => {
    const ctx: any = {
        fns: {
            procs: { ui: { escape: escapeHtml, button } },
            ui: {
                toggle,
                planTaskRow,
                statusBadge: (o: any) => `<span data-tone="${o.tone ?? 'neutral'}">${escapeHtml({ text: o.label })}</span>`,
                progressBar: (o: any) => `<progress value="${o.value}" max="${o.max}"></progress>`,
                inspectorSection: (o: any) => `<details ${o.open ? 'open' : ''}><summary>${escapeHtml({ text: o.title })}${o.badge ?? ''}</summary><div class="border-t border-base-300 px-3 py-3">${o.html}</div></details>`,
                // The runtime calls this in the injected style ctx.fns.x(opts),
                // while the imported module takes (ctx, session, opts) — bridge it.
                agentMetaSection: (o: any) => renderSection(ctx, null, o),
                ...extra,
            },
        },
    };
    return ctx;
};

test("agent meta panel is a static shell with per-section slots", () => {
    const html = render(mkCtx(), null, { agent: { id: "eh", goal: null } as any });
    expect(html).toContain('id="agent-meta-eh"');
    for (const section of ["goal", "automation", "settings", "team", "plan"]) {
        expect(html).toContain(`id="agent-meta-${section}-eh"`);
        expect(html).toContain(`data-meta-section="${section}"`);
    }
    // No live region: sections are redrawn through the RPC push, not polling.
    expect(html).not.toContain("data-live-topic");
    expect(html).not.toContain("hx-get");
    // Automation is pinned first: every other section can render empty, so a
    // section above it would open the panel with a blank gap.
    const order = [...html.matchAll(/data-meta-section="([a-z]+)"/g)].map((match) => match[1]);
    expect(order[0]).toBe("automation");
});

test("renders the display-only observed goals preview", () => {
    const ctx = mkCtx();
    const empty = render(ctx, null, { agent: { id: "eh", scratchpad: {} } as any });
    expect(empty).toContain('<summary>Observed goals<span data-tone="neutral">off</span></summary>');
    expect(empty).toContain('name="enabled"');
    expect(empty).not.toContain('<details open><summary>Observed goals');
    const observed = render(ctx, null, { agent: { id: "eh", scratchpad: { goalTrackingEnabled: true, goalSidecar: { status: "ready", sourceMessageIdx: 4, sidecarId: "sc", goals: [{ id: "g1", statement: "Ship goal-aware agent", verification: "A new message updates the displayed goal without changing execution", status: "active", sourceMessageIdx: 4 }] } } } as any });
    expect(observed).toContain('<details open><summary>Observed goals');
    expect(observed).toContain('Ship goal-aware agent');
    expect(observed).toContain('Check:');
    expect(observed).toContain('A new message updates the displayed goal without changing execution');
    expect(observed).toContain('sidecar sc');
});


test("orders fresh goals first and collapses completed goals", () => {
    const ctx = mkCtx();
    const html = render(ctx, null, { agent: { id: "eh", scratchpad: { goalTrackingEnabled: true, goalSidecar: { status: "ready", goals: [
        { id: "old", statement: "Old active", verification: "old check", status: "active", sourceMessageIdx: 2 },
        { id: "done", statement: "Completed goal", verification: "done check", status: "completed", sourceMessageIdx: 9 },
        { id: "fresh", statement: "Fresh active", verification: "fresh check", status: "active", sourceMessageIdx: 12 },
    ] } } } as any });
    expect(html.indexOf("Fresh active")).toBeLessThan(html.indexOf("Old active"));
    expect(html).toContain("Completed (1)");
    expect(html.indexOf("Completed goal")).toBeGreaterThan(html.indexOf("Completed (1)"));
    expect(html).not.toContain('<details open class="mt-2 rounded-lg');
});

test("renders plan tasks with ids and editor fields", () => {
    const ctx = mkCtx();
    const agent: any = {
        id: "eh", goal: null,
        scratchpad: { plan: { title: "Ship", tasks: [
            { id: "active", title: "Doing", status: "active", instructions: "now" },
            { id: "later", title: "Next", status: "pending", instructions: "later" },
        ] } },
    };
    const html = render(ctx, null, { agent });
    expect(html).toContain('name="title"');
    expect(html).toContain('name="task_id"');
    expect(html).toContain('name="task_title"');
    expect(html).toContain('name="task_instructions"');
    expect(html).toContain('hx-get="/ui/agent/eh/plan/task"');
    const active = html.slice(html.indexOf('data-task-id="active"'), html.indexOf('data-task-id="later"'));
    const pending = html.slice(html.indexOf('data-task-id="later"'));
    expect(active).not.toContain("data-plan-remove");
    expect(pending).toContain("data-plan-remove");
    expect(pending).toContain('data-plan-move="up"');
});

test("renders team members as semantic nested accordions", () => {
    const html = render(mkCtx(), null, {
        agent: { id: "eh", goal: null } as any,
        team: [{ id: "kid", title: "Visual QA", runState: "running", status: "blocked", plan: { title: "QA", tasks: [{ id: "see", title: "Inspect", status: "active" }] }, summary: null, updatedAt: Date.now() }],
    });
    expect(html).toContain("Team");
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('class="ui-button ui-button--xs ui-button--ghost');
    expect(html).toContain('<progress value="0" max="1">');
});

test("automation unifies wake, schedule and watch controls at the top", () => {
    const html = render(mkCtx(), null, { agent: { id: "eh", goal: null } as any, triggers: [{ id: "tr_1", kind: "at", prompt: "Continue", status: "active", nextAt: Date.now() + 1000 }] });
    expect(html).toContain('>Automation');
    const slot = html.slice(html.indexOf('id="agent-meta-automation-eh"'), html.indexOf('id="agent-meta-settings-eh"'));
    expect(slot).toContain("Wake-up");
    expect(slot).toContain("Add schedule");
    expect(slot).toContain("Add watch");
    expect(slot).not.toContain("Function RAG");
    expect(html).toContain(">Agent settings");
});

test("a section renders standalone and an unknown section throws", () => {
    const ctx = mkCtx();
    const html = renderSection(ctx, null, { agent: { id: "eh", goal: null } as any, section: "automation" });
    expect(html).toContain("Automation");
    expect(html).not.toContain("agent-meta-goal");
    expect(() => renderSection(ctx, null, { agent: { id: "eh" } as any, section: "nope" as any })).toThrow(/unknown section/);
});


test("meta panel exposes a persistent collapse control", () => {
    const html = render(mkCtx(), null, { agent: { id: "eh", goal: null } as any });
    expect(html).toContain("data-agent-meta-panel");
    expect(html).toContain('data-action="toggle-agent-meta"');
    expect(html).toContain("data-agent-meta-content");
});
