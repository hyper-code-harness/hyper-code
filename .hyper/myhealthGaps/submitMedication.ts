/** Records a user-confirmed intake through healthrepo and returns the refreshed medication gap card. */
export default async function(ctx:Context,_session:Session|null,opts:{
 /** Trusted submit request after generic validation and idempotency reservation. */ request:Extract<types.flow.FlowRequest,{mode:'submit'}>;
}):Promise<types.flow.FlowOutput>{
 const r=opts.request,flow='medication',data=await ctx.fns.myhealthGaps.medicationContext({}),gaps=await ctx.fns.myhealthGaps.medicationRecordGaps({now:r.now,...data}),gap=gaps.find(g=>g.id===r.target.id);
 if(!gap||gap.revision!==r.target.revision)return{html:await ctx.fns.flow.card({flow,gap:gap??{...r.target,summary:'Карточка изменилась.'},closed:!gap,message:'Ничего не записано: данные изменились. Проверьте актуальную карточку.'})};
 if(r.action!=='record-intake'||Object.keys(r.values).some(k=>!['takenAt','comment'].includes(k)))throw new Error('Unsupported intake action or fields');
 const comment=(r.values.comment??'').trim();if(comment.length>1000||comment.includes('\0'))return{html:await ctx.fns.flow.card({flow,gap,values:r.values,errors:{comment:'Не более 1000 символов, без нулевых символов.'}})};
 const med=data.medications.find(m=>m.id===gap.facts?.medicationId);if(!med||med.dose?.value===undefined||!med.dose.unit)throw new Error('Current regimen dose unavailable');
 const checked=await ctx.fns.flow.localInstant({value:r.values.takenAt!,timezone:data.timezone,now:r.now,min:med.start?.slice(0,10)});if(!checked.instant)return{html:await ctx.fns.flow.card({flow,gap,values:r.values,errors:{takenAt:checked.error??'Invalid time'}})};
 const saved=await ctx.fns.healthrepo.recordMedicationIntake({medicationId:med.id,medicationName:med.name,takenAt:checked.instant,dose:med.dose.value,unit:med.dose.unit,comment,submissionId:r.submissionId});
 const current=await ctx.fns.myhealthGaps.medicationContext({}),after=await ctx.fns.myhealthGaps.medicationRecordGaps({now:r.now,...current}),remains=after.find(g=>g.id===r.target.id),display=r.values.takenAt!.replace('T',' ')+' ('+data.timezone+')';
 return{effects:[{reference:'MedicationAdministration/'+saved.id,label:'Confirmed actual intake'}],html:await ctx.fns.flow.card({flow,gap:remains??{...gap,summary:`${med.name} — ${med.dose.value} ${med.dose.unit}`},closed:!remains,message:(saved.created?'Приём сохранён: ':'Такая запись уже существует: ')+display+'. '+(remains?'Карточка остаётся открытой.':'Запись за день подтверждена. Карточка закрыта.')})};
}
