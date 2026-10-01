// Execute one declared tool by name and return what the model should see.
//
// The single execution path for BOTH protocols: agent.executeMarker parses a
// §marker into arguments and lands here, and the native JSON tool-call loop
// lands here with the arguments the provider decoded. Validation, error
// capture and NUL scrubbing happen once, here, rather than twice with a drift
// between them.
//
// Never throws for a tool's own failure: a broken call is a message to the
// model, not an exception for the run loop. An unknown name is reported the
// same way, because in JSON mode the model picks the name itself.
/** Validates and invokes a registered tool. */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: { /** Runtime, plugin, or tool name. */ name: string; /** Command-line arguments. */ args?: any; /** Agent associated with the operation. */ agent?: types.agent.Agent },
): Promise<{ output: string; content?: types.tools.Content[]; isError: boolean; terminal?: { type: 'html'; html: string; text: string } }> {
    const name = String(opts.name ?? "").trim();
    const all = ctx.fns.tools.list({});
    const tool = all.find((t: any) => t.wireName === name || t.name === name || t.key === name);
    if (!tool) {
        return { output: `Error: unknown tool "${name}". Available: ${all.map((t: any) => t.wireName).join(", ")}`, isError: true };
    }

    const args = opts.args ?? {};
    const check = ctx.fns.tools.validate({ schema: tool.parameters, args });
    if (!check.ok) {
        return { output: `Error: invalid arguments for ${tool.wireName} — ${check.errors.join("; ")}`, isError: true };
    }

    // Rules a JSON Schema cannot state live in the tool's own validator.
    if (tool.validate) {
        const validator = String(tool.validate).split(".").reduce((node: any, seg: string) => node?.[seg], ctx.fns as any);
        if (typeof validator !== "function") {
            return { output: `Error: tool "${tool.wireName}" declares validate "${tool.validate}", but nothing is registered under that name`, isError: true };
        }
        const complaints = [await validator({ args })].flat().filter(Boolean);
        if (complaints.length) {
            return { output: `Error: invalid arguments for ${tool.wireName} — ${complaints.join("; ")}`, isError: true };
        }
    }

    // A tool that names an agent runs against that agent's workspace; the
    // derived ctx is what carries it to ctx.fns.files.* and executeBash.
    let callCtx: any = ctx;
    const wanted = opts.agent ? ctx.fns.session.forAgent({ agent: opts.agent }) : session;
    if (wanted && wanted !== (ctx as any).session) {
        callCtx = Object.create(ctx);
        callCtx.session = wanted;
    }

    // Announce the call BEFORE it starts. Every tool passes through here, so
    // the chat's running indicator and its abort button cover tools that never
    // had to know either exists — including ones added later.
    //
    // The handle is carried on a derived ctx rather than in the arguments: it
    // is not part of any tool's declared schema, and `fns` is a getter reading
    // `this`, so everything the tool calls downstream sees the same object.
    // This derivation must happen BEFORE `fn` is resolved — resolving through
    // the old ctx would hand the implementation a ctx with no toolRun on it.
    const run = ctx.fns.tools.beginRun({
        agentId: opts.agent?.id,
        name: tool.wireName,
        args,
        timeoutMs: typeof args?.timeout === "number" ? args.timeout * 1000 : undefined,
    });
    callCtx = Object.create(callCtx);
    callCtx.toolRun = run;

    // Declaration and implementation are separate files, so the fn is resolved
    // through ctx.fns by its dotted name — which also means a hot-reloaded
    // implementation is picked up without touching the declaration.
    const fn = String(tool.fn).split(".").reduce((node: any, seg: string) => node?.[seg], callCtx.fns);
    if (typeof fn !== "function") {
        ctx.fns.tools.endRun({ id: run.id });
        return { output: `Error: tool "${tool.wireName}" declares fn "${tool.fn}", but nothing is registered under that name`, isError: true };
    }

    let output = "";
    let content: types.tools.Content[] | undefined;
    let terminal: { type: 'html'; html: string; text: string } | undefined;
    let isError = false;
    const attrs: Record<string, any> = { "tool.name": tool.wireName, "agent.id": opts.agent?.id };

    try {
        const telemetry: any = (callCtx.fns.procs as any).telemetry;
        const invoke = () => Promise.race([
            fn(args),
            new Promise((_resolve, reject) => {
                if (run.controller.signal.aborted) return reject(new Error("aborted by user"));
                run.controller.signal.addEventListener("abort", () => reject(new Error("aborted by user")), { once: true });
            }),
        ]);
        const r: any = await (typeof telemetry?.safeSpan === "function"
            ? telemetry.safeSpan({ name: "tool.execute", attrs, fn: invoke })
            : invoke());
        if (typeof r === "string") output = r;
        else {
            output = String(r?.output ?? "");
            if (Array.isArray(r?.content)) content = r.content;
            isError = r?.isError === true;
            if (r?.terminal?.type === 'html') terminal = {
                type: 'html',
                html: String(r.terminal.html ?? ''),
                text: String(r.terminal.text ?? ''),
            };
        }
    } catch (e: any) {
        // A user abort is a RESULT, not a crash. Reporting elapsed time and
        // whatever the tool had already printed gives the model enough to
        // decide what to do next instead of blindly retrying the same call.
        if (run.aborted) {
            const secs = Math.round((Date.now() - run.startedAt) / 1000);
            const tail = run.tail.trimEnd();
            output = `[stopped by the user after ${secs}s — the result is unknown, do not assume it failed]`
                + (tail ? `\nOutput before it was stopped:\n${tail}` : "");
        } else {
            output = "Error: " + (e?.message ?? String(e));
        }
        isError = true;
    } finally {
        // Unconditional: an indicator that outlives its work is the same lie
        // as no indicator at all, just more convincing.
        ctx.fns.tools.endRun({ id: run.id });
    }
    attrs["tool.aborted"] = run.aborted;
    attrs["tool.error"] = isError;
    attrs["tool.output_bytes"] = Buffer.byteLength(output);

    // Postgres text refuses NUL bytes — reading a binary, or bash output that
    // carries one, must not kill the whole run at the INSERT (it did once:
    // agent cm). Replace with U+FFFD.
    output = output.replaceAll("\u0000", "\uFFFD");

    return { output, ...(content?.length ? { content } : {}), ...(terminal ? { terminal } : {}), isError };
}
