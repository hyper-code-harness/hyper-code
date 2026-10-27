// Connect a Zulip account from the chat: name, server URL, email and API key in one
// form. Submit checks the key against /api/v1/users/me, then stores the config in
// the encrypted local registry (zulip/instance:<name>) that zulip.api reads first,
// and adds the name to zulip/instances. The API key never reaches the agent.

export const hint = 'connect a Zulip account (name, server URL, email, API key — key checked live, stored encrypted) — spec `{ name?, url?, email? }` prefill; result `{ instance, fullName, email }`';

export default {
    icon: "chats-circle",
    prepare(_ctx: Context, opts: { spec: Record<string, any> }) {
        const s = opts.spec ?? {};
        return { name: String(s.name ?? ""), url: String(s.url ?? ""), email: String(s.email ?? "") };
    },
    open(ctx: Context, opts: { input: types.input.Row; error?: string | null }) {
        const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
        const s = opts.input.spec;
        const cls = "input input-bordered input-sm w-full bg-base-100";
        const field = (label: string, html: string) => `<label class="flex flex-col gap-1"><span class="text-2xs text-muted">${label}</span>${html}</label>`;
        return `<div class="flex flex-col gap-2">`
            + field("Name (short, e.g. fhir)", `<input name="name" required pattern="[a-zA-Z0-9._-]+" value="${esc(s.name)}" placeholder="fhir" autocomplete="off" class="${cls}">`)
            + field("Server URL", `<input name="url" type="url" required value="${esc(s.url)}" placeholder="https://chat.fhir.org" autocomplete="off" class="${cls}">`)
            + field("Email", `<input name="email" type="email" required value="${esc(s.email)}" placeholder="me@example.com" autocomplete="off" class="${cls}">`)
            + field("API key", `<input name="apiKey" type="password" required autocomplete="new-password" placeholder="••••••••" class="${cls}">`)
            + `<p class="text-3xs text-faint">API key: Zulip → Settings → Account &amp; privacy → API key. Stored encrypted; hidden from the agent and chat history.</p>`
            + `</div>`;
    },
    async submit(ctx: Context, opts: { input: types.input.Row; values: types.input.FormValues }) {
        const v = (k: string) => String(opts.values[k] ?? "").trim();
        const name = v("name"), email = v("email"), apiKey = v("apiKey");
        const url = v("url").replace(/\/+$/, "");
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Name: letters, digits, . _ - only");
        if (!/^https?:\/\/[^\s/]+/.test(url)) throw new Error("Server URL must start with https://");
        if (!email.includes("@")) throw new Error("Enter the account email");
        if (!apiKey) throw new Error("Enter the API key");

        let me: any;
        try {
            const res = await fetch(`${url}/api/v1/users/me`, {
                headers: { Authorization: "Basic " + Buffer.from(`${email}:${apiKey}`).toString("base64") },
                signal: AbortSignal.timeout(15_000),
            });
            me = await res.json().catch(() => ({}));
            if (!res.ok || me.result !== "success") throw new Error(me.msg || `HTTP ${res.status}`);
        } catch (error: any) {
            throw new Error(`Zulip rejected these credentials: ${String(error?.message ?? error)}`);
        }

        await ctx.fns.secrets.putLocal({ namespace: "zulip", name: `instance:${name}`, value: JSON.stringify({ name, url, email, apiKey }), source: "input" });
        const raw = await ctx.fns.secrets.getLocal({ namespace: "zulip", name: "instances" });
        const list: string[] = raw ? (JSON.parse(raw) as any[]).filter((x): x is string => typeof x === "string") : [];
        const instances = [...new Set([...list, name])].sort();
        await ctx.fns.secrets.putLocal({ namespace: "zulip", name: "instances", value: JSON.stringify(instances), source: "input" });
        const state = ((ctx.state as any).zulip ??= { creds: {}, instances: null });
        state.instances = instances;
        if (state.creds) delete state.creds[name];

        const fullName = String(me.full_name ?? "");
        return { result: { instance: name, fullName, email }, summary: `Zulip account "${name}" connected (${fullName || email} @ ${url})` };
    },
    done(ctx: Context, opts: { input: types.input.Row }) {
        const r = opts.input.result ?? {};
        return `<p class="text-2xs text-muted"><i class="ph ph-check-circle" aria-hidden="true"></i> connected <code>${ctx.fns.w.escape({ text: r.instance })}</code> — ${ctx.fns.w.escape({ text: r.fullName || r.email })}</p>`;
    },
} satisfies types.input.Kind;
