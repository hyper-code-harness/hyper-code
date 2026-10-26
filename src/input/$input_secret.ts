// A password, API key or one-time code typed straight into encrypted secret
// storage. The value passes through submit once, on its way to secrets.set; the
// row, the transcript and the agent only ever see the secret:// reference.

export const hint = 'a password, API key or one-time code, saved straight into encrypted secret storage — spec `{ saveAs: "secret://ns/name", mode?: "password" | "otp" | "text", maxlength? }`; you get back only the reference, use it via bash({ secrets: { VAR: ref } }) or secrets.get';

const MODES = ["password", "otp", "text"] as const;

export default {
    icon: "key",
    prepare(ctx: Context, opts: { spec: Record<string, any> }) {
        const { namespace, name } = ctx.fns.secrets.parseRef({ ref: String(opts.spec.saveAs ?? "") });
        const mode = MODES.includes(opts.spec.mode) ? opts.spec.mode : "password";
        const maxlength = Math.max(1, Math.min(Number(opts.spec.maxlength ?? (mode === "otp" ? 16 : 256)) || 256, 4096));
        return { saveAs: `secret://${namespace}/${name}`, mode, maxlength };
    },
    open(ctx: Context, opts: { input: types.input.Row }) {
        const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
        const s = opts.input.spec;
        const otp = s.mode === "otp";
        const w = ctx.fns.w;
        return w.input({
            name: "value", type: s.mode === "text" ? "text" : "password", required: true, maxlength: Number(s.maxlength), label: opts.input.title,
            ...(otp ? { inputmode: "numeric" as const, autocomplete: "one-time-code", placeholder: "123456", mono: true }
                : s.mode === "password" ? { autocomplete: "new-password", placeholder: "••••••••" } : { autocomplete: "off" }),
        }) + w.box({ body: `→ ${esc(s.saveAs)} · the value is hidden from both the agent and chat history`, mix: { mono: true, text: "small", ink: "faint" } });
    },
    async submit(ctx: Context, opts: { input: types.input.Row; values: types.input.FormValues }) {
        const s = opts.input.spec;
        let value = String(opts.values.value ?? "");
        if (s.mode !== "password") value = value.trim();
        if (!value) throw new Error("Enter a value");
        if (s.mode === "otp") {
            if (!/^[0-9 -]{3,16}$/.test(value)) throw new Error("Enter a numeric code");
            value = value.replace(/[ -]/g, "");
        }
        if (value.length > Number(s.maxlength)) throw new Error(`No more than ${s.maxlength} characters`);
        await ctx.fns.secrets.set({ ref: s.saveAs, value, source: "input" });
        return { result: { ref: s.saveAs }, summary: `secret ${s.saveAs} is stored — use it via bash({ secrets: { VAR: "${s.saveAs}" } })` };
    },
    done(ctx: Context, opts: { input: types.input.Row }) {
        const w = ctx.fns.w;
        return w.box({ mix: { layout: "row", gap: "s1", text: "small", ink: "muted" }, body: w.icon({ name: "lock-simple", size: 14 }) + " saved as " + w.box({ tag: "span", body: w.escape({ text: opts.input.result?.ref ?? opts.input.spec.saveAs }), mix: { mono: true } }) });
    },
} satisfies types.input.Kind;
