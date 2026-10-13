/**
 * Validates and saves only a mounted plugin configuration whitelist
 *
 * Use only after a user submits its configuration form. Rejects unknown keys and secret edits, validates the full form before any writes, and resets only whitelisted overrides. Omitted booleans are unchecked only within this plugin form.
 * @param opts.name Exact mounted plugin name.
 * @param opts.values Full submitted form keyed by qualified setting name. Omitted declared booleans become false.
 * @param opts.reset One qualified whitelisted setting to reset; cannot be combined with values.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Exact mounted plugin name. */
        name: string;
        /** Full submitted form keyed by qualified setting name. Omitted declared booleans become false. */
        values?: Record<string, string | boolean | number>;
        /** One qualified whitelisted setting to reset; cannot be combined with values. */
        reset?: string;
    },
): Promise<types.plugins.ConfigurationResult> {
    const config = await ctx.fns.plugins.configuration({name:opts.name});
    if (opts.reset !== undefined) {
     if (opts.values !== undefined) throw new Error('Reset cannot be combined with values');
     const item = config.settings.find(i => i.name === opts.reset);
     if (!item) throw new Error('Reset target is not a configured setting');
     if (item.secret) throw new Error('Secret settings are read-only here; use secure secret management.');
     await ctx.fns.settings.remove({module:item.module,scopeType:'global',key:item.key});
     return ctx.fns.plugins.configuration({name:opts.name});
    }
    if (!opts.values || typeof opts.values !== 'object' || Array.isArray(opts.values)) throw new Error('values form is required');
    const values = opts.values;
    for (const key of Object.keys(values)) if (!config.settings.some(i => i.name === key)) throw new Error('Unknown configuration setting: ' + key);
    const writes: Array<{module:string;key:string;value:string|number|boolean}> = [];
    for (const item of config.settings) {
     const present = Object.prototype.hasOwnProperty.call(values,item.name);
     const raw = values[item.name]; const d = item.descriptor;
     if (present && !['string','number','boolean'].includes(typeof raw)) throw new Error('Invalid field value: ' + item.name);
     if (item.secret) {
      if (present && raw !== '') throw new Error('Secret edits are not supported here. Use secure secret input/storage and the plugin documented secret:// reference setting.');
      continue;
     }
     if (!present && d.type !== 'boolean') continue;
     let value: string|number|boolean;
     if (d.type === 'boolean') {
      if (!present) value = false;
      else if ([true,'true','1','on'].includes(raw as never)) value = true;
      else if ([false,'false','0','off',''].includes(raw as never)) value = false;
      else throw new Error('Invalid boolean: ' + item.name);
     } else if (d.type === 'number') {
      if ((typeof raw !== 'number' && typeof raw !== 'string') || String(raw).trim() === '') throw new Error('Invalid number: ' + item.name);
      value = Number(raw);
      if (!Number.isFinite(value) || (d.min !== undefined && value < d.min) || (d.max !== undefined && value > d.max)) throw new Error('Number outside permitted range: ' + item.name);
     } else if (['string','text','enum'].includes(d.type)) {
      if (typeof raw !== 'string') throw new Error('Expected text: ' + item.name);
      value = raw;
      if (d.type === 'enum' && (!d.options || !d.options.includes(value))) throw new Error('Invalid enum option: ' + item.name);
     } else throw new Error('Unsupported setting type: ' + d.type);
     if (!Object.is(value,item.currentValue)) writes.push({module:item.module,key:item.key,value});
    }
    for (const write of writes) await ctx.fns.settings.set({...write,scopeType:'global',isSecret:false});
    return ctx.fns.plugins.configuration({name:opts.name});
}
