/**
 * Resolves safe declared configuration metadata for a mounted plugin
 *
 * Use for plugin configuration forms. Validates setting and widget ownership against live boot sources, never executes widgets or returns secret values.
 * @param opts.name Exact mounted plugin name.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact mounted plugin name. */
        name: string;
    },
): Promise<types.plugins.ConfigurationResult> {
    const plugin = ctx.fns.procs.modules.list({}).find(m => m.plugin && m.name === opts.name);
    if (!plugin) throw new Error('Mounted plugin not found');
    const pkg = await ctx.fns.plugins.readMetadata({ path: plugin.dir + '/package.json' });
    const raw = (pkg as {procs?: {configuration?: unknown}}).procs?.configuration;
    const result: types.plugins.ConfigurationResult = {name: plugin.name, settings: [], secrets: [], widget: null};
    if (raw === undefined) return result;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid procs.configuration');
    const config = raw as {settings?: unknown;widget?: unknown;secrets?: unknown};
    if (config.settings === undefined) config.settings = [];
    if (Object.keys(config).some(k => !['settings','widget','secrets'].includes(k))) throw new Error('Unknown configuration property');
    if (!Array.isArray(config.settings) || config.settings.some(k => typeof k !== 'string') || new Set(config.settings).size !== config.settings.length) throw new Error('configuration.settings must contain unique declared setting names');
    const entries = ctx.state.procs.boot.entries ?? [];
    const path = await import('node:path');
    const { realpath } = await import('node:fs/promises');
    const owner = await realpath(plugin.dir);
    const owned = async (abs: string) => { const rel = path.relative(owner, await realpath(abs)); return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel); };
    const registry = ctx.state.settings?.registry;
    for (const name of config.settings as string[]) {
     const dot = name.lastIndexOf('.'); const module = name.slice(0,dot); const key = name.slice(dot+1);
     const entry = entries.filter(e => e.kind === 'setting' && e.module === module && e.name === key).at(-1);
     const d = registry?.get(name);
     if (dot <= 0 || !plugin.namespaces.includes(module) || !entry || entry.root !== plugin.name || !(await owned(entry.abs)) || !d) throw new Error('Setting not owned or declared: ' + name);
    }
    if (config.widget !== undefined) {
     if (typeof config.widget !== 'string') throw new Error('configuration.widget must be a runtime function name');
     const name = config.widget; const dot = name.lastIndexOf('.');
     if (!/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/.test(name) || name.split('.').some(k => ['__proto__','constructor','prototype'].includes(k))) throw new Error('Invalid widget function name');
     const entry = entries.filter(e => e.kind === 'fn' && e.module === name.slice(0,dot) && e.runtimeName === name.slice(dot+1)).at(-1);
     if (!plugin.fns.includes(name) || !plugin.namespaces.includes(name.slice(0,dot)) || !entry || entry.root !== plugin.name || !(await owned(entry.abs))) throw new Error('Widget is not an owned runtime function: ' + name);
     const live = name.split('.').reduce((value: unknown, key) => value && (value as Record<string, unknown>)[key], ctx.state.registry as unknown) as (((...args: never[]) => unknown) & {meta?: {abs?: string}}) | undefined;
     if (typeof live !== 'function' || !live.meta?.abs || path.resolve(live.meta.abs) !== path.resolve(entry.abs)) throw new Error('Stale widget runtime function: ' + name);
     result.widget = name;
    }
    if (config.secrets !== undefined) {
     if (!Array.isArray(config.secrets) || config.secrets.length > 100) throw new Error('configuration.secrets must be an array of at most 100 descriptors');
     const names = new Set<string>(); const refs = new Set<string>();
     for (const rawSecret of config.secrets) {
      if (!rawSecret || typeof rawSecret !== 'object' || Array.isArray(rawSecret)) throw new Error('Invalid secret descriptor');
      const s = rawSecret as Record<string, unknown>;
      if (Object.keys(s).some(k => !['name','ref','title','description','required'].includes(k))) throw new Error('Unknown secret descriptor property');
      if (typeof s.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(s.name) || names.has(s.name)) throw new Error('Invalid or duplicate secret name');
      if (typeof s.ref !== 'string' || s.ref.length > 300 || s.ref.trim() !== s.ref || refs.has(s.ref)) throw new Error('Invalid or duplicate secret reference');
      for (const [key, limit] of [['title',200],['description',2000]] as const) if (s[key] !== undefined && (typeof s[key] !== 'string' || (s[key] as string).length > limit)) throw new Error('Invalid secret ' + key);
      if (s.required !== undefined && typeof s.required !== 'boolean') throw new Error('Invalid secret required flag');
      const parsed = ctx.fns.secrets.parseRef({ref:s.ref});
      if (!plugin.namespaces.includes(parsed.namespace)) throw new Error('Secret reference namespace is not owned by plugin');
      names.add(s.name); refs.add(s.ref);
      result.secrets.push({name:s.name,ref:s.ref,...(typeof s.title === 'string' ? {title:s.title} : {}),...(typeof s.description === 'string' ? {description:s.description} : {}),...(typeof s.required === 'boolean' ? {required:s.required} : {}),configured:false});
     }
     // Presence only: list never decrypts. Narrow the bounded search to this name.
     for (const secret of result.secrets) {
      const parsed = ctx.fns.secrets.parseRef({ref:secret.ref});
      const listed = await ctx.fns.secrets.list({namespace:parsed.namespace,query:parsed.name,limit:500});
      secret.configured = listed.some(s => s.ref === secret.ref);
     }
    }
    const declared = (config.settings as string[]).length === 0 ? [] : await ctx.fns.settings.declared({});
    for (const name of config.settings as string[]) {
     const item = declared.find(i => i.module + '.' + i.key === name);
     if (!item) throw new Error('Declared setting disappeared: ' + name);
     const d = item.descriptor; const secret = d.type === 'secret';
     const descriptor: types.plugins.ConfigurationResult['settings'][number]['descriptor'] = {type: d.type};
     for (const key of ['title','description','env'] as const) if (typeof d[key] === 'string') descriptor[key] = d[key];
     if (!secret) { descriptor.default = d.default; if (Array.isArray(d.options)) descriptor.options = d.options; if (typeof d.min === 'number') descriptor.min = d.min; if (typeof d.max === 'number') descriptor.max = d.max; }
     result.settings.push({name,module:item.module,key:item.key,descriptor,source:item.source,secret,configured:item.currentValue !== undefined && item.currentValue !== null && item.currentValue !== '',...(!secret ? {currentValue:item.currentValue} : {})});
    }
    return result;
}
