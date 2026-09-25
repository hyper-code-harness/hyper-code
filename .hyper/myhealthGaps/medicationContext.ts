/** Reads current selected medication regimens and actual intake facts exclusively from healthrepo. */
export default async function(ctx:Context,_session:Session|null,_opts:{}):Promise<{timezone:string;medications:Array<{id:string;name:string;status:string;timing?:string;start?:string;end?:string;dose?:{value?:number;unit?:string};sourceId?:string}>;intakes:Array<{id:string;medication_id:string;status:string;taken_at:string}>}>{
 const timezone='Europe/Lisbon',selected=new Set(['2025-09-01-atorvastatin','2026-09-04-indapamide']),{medications}=await ctx.fns.healthrepo.medications({includeStopped:true});
 const meds=medications.filter(m=>selected.has(m.id)).map(m=>({...m,sourceId:m.id}));
 const rows:any[]=await ctx.fns.procs.db.select({sql:`select resource->>'id' id,split_part(resource->'medicationReference'->>'reference','/',2) medication_id,resource->>'status' status,resource->>'effectiveDateTime' taken_at from healthrepo.medication_administrations where resource->>'status'='completed' and split_part(resource->'medicationReference'->>'reference','/',2) in ('2025-09-01-atorvastatin','2026-09-04-indapamide')`,params:[]});
 return{timezone,medications:meds,intakes:rows.map(r=>({...r,status:'taken',taken_at:new Date(r.taken_at).toISOString()}))};
}
