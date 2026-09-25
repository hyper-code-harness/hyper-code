/**
 * Computes the next wall-clock occurrence of a five-field cron expression in an IANA timezone
 *
 * Parse a standard five-field minute/hour/day-of-month/month/day-of-week cron expression and return its next Unix timestamp. Supports wildcards, lists, ranges and steps; day-of-month and day-of-week use standard OR semantics when both are restricted. Use internally when creating or advancing agent cron triggers.
 * @param opts.expression Five-field cron expression: minute hour day-of-month month day-of-week.
 * @param opts.timezone IANA timezone such as Europe/Lisbon.
 * @param opts.after Exclusive lower-bound Unix timestamp in milliseconds; defaults to now.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Five-field cron expression: minute hour day-of-month month day-of-week. */
        expression: string;
        /** IANA timezone such as Europe/Lisbon. */
        timezone: string;
        /** Exclusive lower-bound Unix timestamp in milliseconds; defaults to now. */
        after?: number;
    },
): Promise<number> {
    const expression = String(opts.expression ?? "").trim();
    const timezone = String(opts.timezone ?? "").trim();
    if (!timezone) throw new Error("agent.nextCronAt: timezone is required");
    try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date()); } catch { throw new Error(`agent.nextCronAt: invalid timezone ${timezone}`); }
    const fields = expression.split(/\s+/);
    if (fields.length !== 5) throw new Error("agent.nextCronAt: expression must have five fields");
    function parseField(text:string,min:number,max:number):Set<number>{ const out=new Set<number>(); for(const raw of text.split(",")){ const pair=raw.split("/"); const base=String(pair[0]); const step=pair[1]===undefined?1:Number(pair[1]); if(!Number.isInteger(step)||step<1)throw new Error(`invalid cron step: ${raw}`); let lo=min,hi=max; if(base!=="*"){if(base.includes("-")){const nums=base.split("-").map(Number);lo=Number(nums[0]);hi=Number(nums[1]);}else lo=hi=Number(base);} if(!Number.isInteger(lo)||!Number.isInteger(hi)||lo<min||hi>max||lo>hi)throw new Error(`invalid cron field: ${raw}`); for(let n=lo;n<=hi;n+=step)out.add(n===7&&max===7?0:n);} return out; }
    const minutes=parseField(String(fields[0]),0,59),hours=parseField(String(fields[1]),0,23),doms=parseField(String(fields[2]),1,31),months=parseField(String(fields[3]),1,12),dows=parseField(String(fields[4]),0,7);
    const domAny=fields[2]==="*",dowAny=fields[4]==="*";
    const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",weekday:"short"}); const weekdays:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    let t=Math.floor(Number(opts.after??Date.now())/60000)*60000+60000;
    for(let i=0;i<1_100_000;i++,t+=60000){const parts:Record<string,string>={};for(const p of fmt.formatToParts(new Date(t)))if(p.type!=="literal")parts[p.type]=p.value; const minute=Number(parts.minute),hour=Number(parts.hour),day=Number(parts.day),month=Number(parts.month),dow=Number(weekdays[String(parts.weekday)]); const dayMatch=domAny&&dowAny?true:domAny?dows.has(dow):dowAny?doms.has(day):(doms.has(day)||dows.has(dow));if(minutes.has(minute)&&hours.has(hour)&&months.has(month)&&dayMatch)return t;} throw new Error("agent.nextCronAt: no occurrence found within search horizon");
}
