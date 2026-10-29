/**
 * Draws the system prompt field of the New agent form: a picker of named prompts with the chosen one's text, and
 * "Write your own…", which opens an editor on a copy of the chosen prompt with an optional name to save it under.
 *
 * Submits `systemPromptName` (a name, or `__custom`), and for own text `systemPromptCore` and `saveSystemPromptAs`;
 * agent.createFromValues reads them. Use inside the agent.newForm form only.
 * @param opts.prompts Prompts to offer (agent.systemPrompts).
 * @param opts.current Name selected initially.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Prompts to offer (agent.systemPrompts). */
    prompts: Array<{ name: string; title: string; description: string; source: string; text: string; tokens: number }>;
    /** Name selected initially. */
    current: string;
}): string {
    const esc = (s: unknown) => ctx.fns.w.escape({ text: s });
    const label = (p: { name: string; title: string; source: string; tokens: number }) =>
        `${p.title}${p.title.toLowerCase() === p.name ? "" : ` (${p.name})`}${p.source === "builtin" ? "" : p.source === "project" ? " · project" : " · mine"} · ${p.tokens.toLocaleString("en-US")}t`;
    const options = opts.prompts.map(p => `<option value="${esc(p.name)}"${p.name === opts.current ? " selected" : ""}>${esc(label(p))}</option>`).join("")
        + `<option value="__custom">Write your own…</option>`;
    const previews = opts.prompts.map(p => `<details data-system-prompt-preview="${esc(p.name)}" class="rounded-md border border-base-300 bg-base-100"${p.name === opts.current ? "" : " hidden"}><summary class="cursor-pointer px-3 py-2 text-sm">${esc(p.description)} <span class="text-faint">· show text</span></summary><pre class="max-h-80 overflow-auto border-t border-base-300 bg-base-200 p-3 text-2xs whitespace-pre-wrap">${esc(p.text)}</pre></details>`).join("");
    const editor = `<div data-system-prompt-editor hidden class="space-y-2 rounded-md border border-base-300 bg-base-100 p-3">
<textarea name="systemPromptCore" rows="12" placeholder="Base system prompt" class="textarea textarea-bordered w-full bg-base-100 font-mono text-2xs"></textarea>
<label class="block text-sm"><span class="mb-1 block text-faint">Save as (optional — reuse it later by this name)</span><input name="saveSystemPromptAs" maxlength="40" pattern="[a-z0-9][a-z0-9._\\-]{0,39}" placeholder="e.g. my-reviewer" class="input input-bordered w-full bg-base-100 font-mono"></label>
</div>`;
    // The editor starts from a copy of the prompt chosen before "Write your own…", so a variant is a small edit.
    const script = `<script>(function(){var s=document.currentScript.parentNode,sel=s.querySelector('[name=systemPromptName]'),ed=s.querySelector('[data-system-prompt-editor]'),ta=ed.querySelector('textarea'),prev=sel.value;sel.addEventListener('change',function(){var v=sel.value;s.querySelectorAll('[data-system-prompt-preview]').forEach(function(d){d.hidden=d.dataset.systemPromptPreview!==v});ed.hidden=v!=='__custom';ta.required=v==='__custom';if(v==='__custom'){if(!ta.value){var src=s.querySelector('[data-system-prompt-preview="'+CSS.escape(prev)+'"] pre');ta.value=src?src.textContent:''}ta.focus()}else prev=v})})()</script>`;
    return `<div class="space-y-2" data-system-prompt-field><label class="block text-sm"><span class="mb-1 block text-faint">System prompt</span><select name="systemPromptName" class="select select-bordered w-full bg-base-100">${options}</select></label>${previews}${editor}${script}</div>`;
}
