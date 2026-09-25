/**
 * Compute daily missing-intake gaps with declaration-owned actual intake forms for two selected medications
 *
 * Pure read-only computation for personal medication gaps. Uses actual taken timestamps in the configured local day, excludes PRN and stopped statements, deduplicates intakes, and never infers a missed dose or a due time.
 * @param opts.now ISO timestamp used as the evaluation clock.
 * @param opts.timezone IANA timezone from the health repository intake import configuration.
 * @param opts.medications Current curated repository MedicationStatements; only the two explicitly selected stable IDs are eligible.
 * @param opts.intakes Actual database intake records with explicit status and timezone-bearing timestamps; pending is not taken.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** ISO timestamp used as the evaluation clock. */
        now: string;
        /** IANA timezone from the health repository intake import configuration. */
        timezone: string;
        /** Current curated repository MedicationStatements; only the two explicitly selected stable IDs are eligible. */
        medications: Array<{id:string;name:string;status:string;timing?:string;start?:string;end?:string;dose?:{value?:number;unit?:string};sourceId?:string}>;
        /** Actual database intake records with explicit status and timezone-bearing timestamps; pending is not taken. */
        intakes: Array<{id:string;medication_id:string;status:string;taken_at:string}>;
    },
): Promise<types.flow.Gap[]> {
    const selected:Record<string,string[]> = {'2025-09-01-atorvastatin':['2025-09-01-atorvastatin'],'2026-09-04-indapamide':['2026-09-04-indapamide']};
    const now=new Date(opts.now); if(!Number.isFinite(now.getTime())) throw new Error('Invalid evaluation clock');
    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:opts.timezone,year:'numeric',month:'2-digit',day:'2-digit'});
    const day=(d:Date)=>{const p=Object.fromEntries(fmt.formatToParts(d).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;}; const today=day(now);
    const gaps:types.flow.Gap[]=[];
    for(const med of opts.medications){const ids=selected[med.id];if(!ids||med.status!=='active'||/PRN|по необходимости|по потребности|as needed/i.test(med.timing??'')||(med.start&&med.start.slice(0,10)>today)||(med.end&&med.end.slice(0,10)<today))continue;
    const taken=[...new Map(opts.intakes.filter(r=>ids.includes(r.medication_id)&&r.status==='taken'&&/(Z|[+-]\d{2}:\d{2})$/.test(r.taken_at)&&Number.isFinite(Date.parse(r.taken_at))&&Date.parse(r.taken_at)<=now.getTime()).map(r=>[r.id,r])).values()];
    if(taken.some(r=>day(new Date(r.taken_at))===today))continue;
    const last=taken.map(r=>new Date(r.taken_at).toISOString()).sort().at(-1)??null;
    const facts={medicationId:med.id,sourceId:med.sourceId??null,doseValue:med.dose?.value??null,doseUnit:med.dose?.unit??null,name:med.name,start:med.start??null,end:med.end??null,localDate:today,timezone:opts.timezone,lastTakenAt:last,intakeSource:'healthrepo.medication_administrations (status=completed)',regimenSource:'healthrepo MedicationStatement',schedule:'Точное время не задано; проверка записи за календарный день, не пропуска дозы',timing:med.timing??'Не указано',sourceLink:'/healthrepo/medications'};
    const dose=med.dose?.value!==undefined&&med.dose?.unit?String(med.dose.value)+' '+med.dose.unit:'';
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:opts.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));const value=parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
    const form:types.flow.GapForm|undefined=med.sourceId&&dose?{id:'record-intake',label:'Принял',fields:[{name:'takenAt',type:'datetime-local',label:'Фактические дата и время',timezone:opts.timezone,min:med.start?.slice(0,10),value},{name:'comment',type:'text',label:'Комментарий',maxLength:1000}]}:undefined;
    gaps.push({id:'medication-record:'+med.id+':'+today,revision:String(Bun.hash(JSON.stringify(facts))),summary:med.name+(dose?' — '+dose:'')+' — нет записи о приёме за '+today+' ('+opts.timezone+'). Это не означает пропуск дозы.',display:{title:med.name,subtitle:dose+' · '+(med.timing??''),status:'Нет записи за сегодня',detail:'Последний записанный приём: '+(last?new Intl.DateTimeFormat('ru-RU',{timeZone:opts.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(last))+' ('+opts.timezone+')':'нет записи')},for:'Проверяем запись за '+today+', не пропуск дозы. Точное время по расписанию не задано.',facts,form});
    }return gaps;
}
