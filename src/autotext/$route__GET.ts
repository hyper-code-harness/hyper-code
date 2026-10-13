/** GET /autotext — sandbox for comparing prose completion models. */
export default async function (_ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const main = `<div class="mx-auto max-w-4xl p-5 sm:p-8">
<h1 class="text-2xl font-semibold">Autotext lab</h1>
<p class="mt-2 text-sm text-subtle">Compare short continuations for articles and notes. Nothing is saved; suggestions appear as grey ghost text at the cursor.</p>
<div class="mt-5 flex flex-wrap items-end gap-4">
<label class="grid gap-1 text-sm">Model<select id="autotext-model" class="rounded-md border border-base-300 bg-base-100 px-3 py-2"><option value="codex:gpt-6-luna">Codex · GPT-6 Luna</option><option value="claude-code:claude-haiku-4-5">Claude · Haiku 4.5</option><option value="codex:gpt-5.6-luna">Codex · GPT-5.6 Luna</option><option value="groq:openai/gpt-oss-20b">Groq · GPT-OSS 20B</option><option value="groq:openai/gpt-oss-120b">Groq · GPT-OSS 120B</option><option value="groq:qwen/qwen3.8-27b">Groq · Qwen 3.8 27B</option><option value="openrouter:z-ai/glm-5.3-flash">OpenRouter · GLM-5.3-Flash</option></select></label>
<label class="flex items-center gap-2 pb-2 text-sm"><input id="autotext-auto" type="checkbox" checked> Suggest after pause</label><label class="flex items-center gap-2 pb-2 text-sm"><input id="autotext-rewrite" type="checkbox" checked> Fix sentence + continue</label>
</div>
<p class="mt-5 text-sm font-medium">Article draft</p>
<div id="autotext-editor" class="mt-2 min-h-80 w-full rounded-md border border-base-300 bg-base-100 focus-within:border-primary"></div>
<div class="mt-3 flex flex-wrap items-center gap-3"><button id="autotext-request" type="button" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-content">Suggest</button><span id="autotext-status" role="status" aria-live="polite" class="text-xs text-subtle"></span></div>
<p class="mt-3 text-xs text-subtle">Tab accepts the preview (including the highlighted replacement), Esc dismisses it, Ctrl/Cmd+Space asks explicitly. Auto mode waits 3 seconds after typing; any edit, cursor move or model switch cancels the pending request.</p>
</div><script src="/autotext/editor.js"></script>`;
    return { title: "Autotext", main };
}
