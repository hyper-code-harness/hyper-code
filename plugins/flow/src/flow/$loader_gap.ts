/** Collects function-only $gap_<name>.ts declarations; later scanner roots override earlier names. */
export default async function(ctx:Context, _session:Session|null, opts:{entries:Array<{name:string;rel:string;abs:string;fn?:types.flow.State['declarations'][string]['fn']}>}):Promise<void> {
 const declarations:types.flow.State['declarations'] = Object.create(null);
 for(const entry of opts.entries){
  if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(entry.name)) throw new Error(`Invalid gap declaration name: ${entry.name}`);
  let fn:types.flow.State['declarations'][string]['fn'];
  try {fn=entry.fn ?? (await import(entry.abs+`?mtime=${await Bun.file(entry.abs).stat().then(s=>s.mtimeMs).catch(()=>Date.now())}`)).default;
   if(typeof fn!=='function') throw new Error(`${entry.rel}: $gap must export a function, not a scheduler declaration`);
  } catch(error) {const message=String(error instanceof Error?error.message:error);fn=async()=>{throw new Error(message);};}
  declarations[entry.name]={name:entry.name,source:entry.abs,fn};
 }
 ctx.state.flow ??= {declarations};
 ctx.state.flow.declarations=declarations;
}
