// ONLINE CONSULTATIONS: exposes free date/time values only; never returns patient rows.
const {db,json,method,validUuid}=require('./_consult');
const TZ='Asia/Kolkata';
function localDate(d=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(d)}
function addDays(iso,n){const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function weekday(iso){return new Date(iso+'T00:00:00Z').getUTCDay()}
function minutes(t){const [h,m]=String(t).split(':').map(Number);return h*60+m}
module.exports=async function(req,res){
  if(!method(req,res,['GET'])) return;
  const doctorId=String(req.query.doctor_id||''); if(!validUuid(doctorId)) return json(res,400,{error:'Choose a doctor'});
  try{
    const s=db(),now=new Date(),today=localDate(now),end=addDays(today,13);
    await s.from('online_consultations').update({status:'payment_pending',hold_expires_at:null,updated_at:now.toISOString()})
      .eq('status','pending_payment').lt('hold_expires_at',now.toISOString());
    const [{data:rules,error:rErr},{data:confirmed,error:cErr},{data:holds,error:hErr}]=await Promise.all([
      s.from('doctor_online_slots').select('weekday,start_time,end_time,slot_minutes').eq('doctor_id',doctorId).eq('is_active',true),
      s.from('online_consultations').select('appointment_date,appointment_time').eq('doctor_id',doctorId).eq('status','confirmed').gte('appointment_date',today).lte('appointment_date',end),
      s.from('online_consultations').select('appointment_date,appointment_time').eq('doctor_id',doctorId).eq('status','pending_payment').gt('hold_expires_at',now.toISOString()).gte('appointment_date',today).lte('appointment_date',end)
    ]);
    if(rErr||cErr||hErr) throw rErr||cErr||hErr;
    const taken=new Set([...(confirmed||[]),...(holds||[])].map(x=>`${x.appointment_date}|${String(x.appointment_time).slice(0,5)}`));
    const slots=[];
    for(let i=0;i<14;i++){
      const date=addDays(today,i),dow=weekday(date);
      for(const r of rules||[]) if(Number(r.weekday)===dow){
        const start=minutes(r.start_time),finish=minutes(r.end_time),step=Number(r.slot_minutes);
        for(let t=start;t+step<=finish;t+=step){
          const time=`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
          if(date===today){const current=Number(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now).replace(':',''));if(Number(time.replace(':',''))<=current)continue;}
          if(!taken.has(`${date}|${time}`)) slots.push({date,time});
        }
      }
    }
    json(res,200,{slots});
  }catch(e){json(res,500,{error:'Could not load appointment times'});}
};
