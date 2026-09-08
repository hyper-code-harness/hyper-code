/**
 * Validate an actual local datetime and resolve its unique timezone instant
 *
 * Use for actual timestamps. Rejects invalid calendar dates, nonexistent and ambiguous DST wall times, future instants and dates before the source start. Never guesses an offset.
 * @param opts.value Actual wall time YYYY-MM-DDTHH:mm.
 * @param opts.timezone Trusted IANA timezone.
 * @param opts.now Server ISO clock; no future time allowed.
 * @param opts.min Earliest source date YYYY-MM-DD.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Actual wall time YYYY-MM-DDTHH:mm. */
        value: string;
        /** Trusted IANA timezone. */
        timezone: string;
        /** Server ISO clock; no future time allowed. */
        now: string;
        /** Earliest source date YYYY-MM-DD. */
        min?: string;
    },
): Promise<{instant?:string; error?:string}> {
    const fail=(error:string)=>({error});
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(opts.value)) return fail('Введите дату и время полностью.');
    const wall=Date.parse(opts.value+'Z');
    if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==opts.value) return fail('Такой даты или времени нет.');
    if(opts.min && opts.value.slice(0,10)<opts.min) return fail('Дата раньше начала текущего назначения: '+opts.min+'.');
    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:opts.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    const local=(t:number)=>{const p=Object.fromEntries(fmt.formatToParts(new Date(t)).map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;};
    const matches:number[]=[];
    for(let offset=-14*60;offset<=14*60;offset++){const t=wall+offset*60000;if(local(t)===opts.value)matches.push(t);}
    if(matches.length===0)return fail('Это местное время не существует из-за перевода часов. Укажите фактическое время.');
    if(matches.length>1)return fail('Это время повторяется при переводе часов. Форма не может выбрать смещение: запись не сохранена; нужна запись с явным UTC-смещением.');
    if(!Number.isFinite(Date.parse(opts.now))||matches[0]!>Date.parse(opts.now))return fail('Будущее время нельзя записать как уже состоявшийся приём.');
    return {instant:new Date(matches[0]!).toISOString()};
}
