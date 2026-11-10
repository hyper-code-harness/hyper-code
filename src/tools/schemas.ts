// The declared tools, shaped for one provider's wire format.
//
// Three dialects, one registry (see docs/toolcall-protocols.md):
//   openai     — chat completions: { type:"function", function:{ name, parameters, strict } }
//   responses  — OpenAI Responses API: the same fields, flattened onto the item
//   anthropic  — Messages API: `input_schema` instead of `parameters`, no wrapper
//
// `strict: true` is constrained decoding — the model cannot emit a token that
// breaks the schema. It is legal only when every object says
// additionalProperties:false and lists all its properties as required, so we
// ask for it exactly when the declaration already satisfies that.
/**
 * Builds the provider wire-format schemas of the registered tools for one LLM request.
 *
 * Opt-in tools (`optIn: true`) are included only when `only` names them.
 * @param opts.api Wire dialect: `openai`, `responses` or `anthropic`.
 * @param opts.only Tool names (wire or bare) to keep, usually agent.tools; empty keeps every tool that is not opt-in.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Wire dialect: `openai`, `responses` or `anthropic`. */
        api: string;
        /** Tool names (wire or bare) to keep, usually agent.tools; empty keeps every tool that is not opt-in. */
        only?: string[];
    },
): any[] {
    let tools = ctx.fns.tools.list({});
    if (opts?.only?.length) tools = tools.filter((t: any) => opts.only!.includes(t.wireName) || opts.only!.includes(t.name));
    // An opt-in tool ships only when the agent named it; without a list it stays out.
    else tools = tools.filter((t: any) => !t.optIn);
    const api = String(opts?.api ?? "openai");

    return tools.map((t: any) => {
        const parameters = t.parameters;
        if (api === "anthropic") {
            return { name: t.wireName, description: t.description, input_schema: parameters };
        }
        const strict = isStrictable(parameters);
        if (api === "responses") {
            return { type: "function", name: t.wireName, description: t.description, parameters, strict };
        }
        return { type: "function", function: { name: t.wireName, description: t.description, parameters, strict } };
    });
}

// OpenAI rejects strict schemas that have optional properties — and it checks
// EVERY object, not just the top one: an array's `items` with an optional field
// is a 400 ("'required' is required to be supplied and to be an array including
// every key in properties"). So the question is asked recursively, and a tool
// with optional options anywhere ships non-strict rather than not shipping.
function isStrictable(schema: any): boolean {
    if (!schema || typeof schema !== "object") return true;
    const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

    if (types.includes("object")) {
        if (schema.additionalProperties !== false) return false;
        const props = Object.entries(schema.properties ?? {});
        const required: string[] = schema.required ?? [];
        if (!props.every(([name]) => required.includes(name))) return false;
        return props.every(([, spec]) => isStrictable(spec));
    }
    if (types.includes("array")) return isStrictable(schema.items);
    return true;
}
