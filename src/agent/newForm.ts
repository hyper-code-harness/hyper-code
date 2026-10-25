/**
 * Draws the fields of the new-agent form: title, model, project, workspace folder, prompt presets, instructions.
 *
 * Use for the /agent/new page and popup. A chosen project fills the workspace folder with its own; with
 * `project` that project is preselected (the "New agent in this project" row of the Projects menu widget).
 * @param opts.project Project id or slug to preselect.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Project id or slug to preselect. */
    project?: string;
} = {}): Promise<string> {
    const esc = (s: any) => ctx.fns.w.escape({ text: s });
    const last = ((await ctx.fns.procs.db.select({ sql: "SELECT value FROM kv WHERE key = 'last-model'" }).catch(() => [])) as any[])[0]?.value;
    const groups = await ctx.fns.llm.listModels({});
    const usable = new Set(Object.values(groups).flat());
    const configured = (await ctx.fns.settings.modelDefault({})) ?? ctx.env.MODEL ?? '';
    // Preference is useful only while that route is callable on this instance.
    const model = usable.has(last) ? last : usable.has(configured) ? configured : usable.values().next().value ?? '';
    const base = await ctx.fns.agent.getBasePromptParts({});
    const presets = await ctx.fns.agent.listPromptPresets({});
    const picker = await ctx.fns.agent.modelPickerHtml({ current: model, mode: 'form' });
    const projects = await ctx.fns.project.list({});
    const chosen = projects.find(p => p.id === opts.project || p.slug === opts.project);
    // Picking a project puts its folder into the workspace field (the agent works there unless changed).
    const projectPicker = projects.length ? `<label class="block text-sm"><span class="mb-1 block text-faint">Project</span><select name="projectId" class="select select-bordered w-full bg-base-100" onchange="var o=this.selectedOptions[0],i=document.getElementById('workspace-dir-input');if(!i)return;var d=o&&o.dataset.dir;i.value=d?'':i.dataset.fallback;i.placeholder=d?d+' (project folder)':'';i.required=!d;i.dispatchEvent(new Event('input',{bubbles:true}))"><option value="">No project</option>${projects.map(p => `<option value="${esc(p.id)}" data-dir="${esc(p.defaultDir ?? '')}"${p === chosen ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>` : '';
    // Inside a project the folder stays empty: the agent inherits the project's folder (and host) unless typed.
    const workspaceDefault = chosen?.defaultDir ? '' : process.cwd();
    const workspacePlaceholder = chosen?.defaultDir ? `${chosen.defaultDir} (project folder)` : '';
    const presetHtml = Object.entries(presets).map(([id, p]: any) => `<details class="rounded-md border border-base-300 bg-base-100"><summary class="cursor-pointer px-3 py-2"><label class="flex gap-2 text-sm"><input type="checkbox" name="promptPreset" value="${esc(id)}"><span>${esc(p.label)} <span class="text-faint">${Math.ceil((p.text?.length || 0) / 4)}t</span></span></label></summary><pre class="border-t border-base-300 bg-base-200 p-3 text-2xs whitespace-pre-wrap">${esc(p.text)}</pre></details>`).join('');
    return `<input name="title" maxlength="120" placeholder="title (optional)" class="input input-bordered w-full bg-base-100">${picker}${projectPicker}<div class="relative"><input id="workspace-dir-input" name="workspaceDir" value="${esc(workspaceDefault)}" placeholder="${esc(workspacePlaceholder)}" data-fallback="${esc(process.cwd())}"${chosen?.defaultDir ? '' : ' required'} autocomplete="off" aria-autocomplete="list" aria-controls="workspace-dir-suggestions" hx-get="/agent/dirs" hx-trigger="focus, input changed delay:250ms" hx-target="#workspace-dir-suggestions" hx-swap="innerHTML" hx-on::before:swap="if(event.detail.ctx?.target?.id==='workspace-dir-suggestions'&&!this.matches(':focus')&&!document.getElementById('workspace-dir-suggestions').matches(':focus-within'))event.preventDefault()" class="input input-bordered w-full bg-base-100 font-mono"><div id="workspace-dir-suggestions" role="listbox" aria-label="Workspace folders" class="absolute z-50 mt-1 w-full overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-lg empty:hidden"></div><script>(function(){var i=document.getElementById("workspace-dir-input"),l=document.getElementById("workspace-dir-suggestions");if(!i||!l||l.dataset.wired)return;l.dataset.wired="1";var close=function(){l.replaceChildren()};var outside=function(e){if(!i.contains(e.target)&&!l.contains(e.target))close()};["pointerdown","click","focusin"].forEach(function(t){document.addEventListener(t,outside,true)});document.addEventListener("keydown",function(e){if(e.key==="Escape")close()},true)})()</script><div id="workspace-dir-status" class="mt-1 min-h-5 text-2xs" hx-get="/agent/dirs/status" hx-trigger="load" hx-include="#workspace-dir-input"></div></div><details class="rounded border border-base-300"><summary class="p-2">Base system prompt · ${Math.ceil((base.core?.length || 0) / 4)}t</summary><pre class="border-t border-base-300 bg-base-200 p-3 text-2xs whitespace-pre-wrap">${esc(base.core)}</pre></details>${presetHtml}<textarea name="systemPrompt" rows="4" placeholder="custom instructions (optional)" class="textarea textarea-bordered w-full bg-base-100 font-mono"></textarea>`;
}
