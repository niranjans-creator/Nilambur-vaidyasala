// ONLINE CONSULTATIONS: expires 15-minute holds, queues reminders and retries mail.
const {db,json,method,sendJob}=require('./_consult');
function datetime(date,time){return new Date(`${date}T${String(time).slice(0,8)}+05:30`)}
module.exports=async function(req,res){
  if(!method(req,res,['GET','POST']))return;
  const secret=process.env.CRON_SECRET;
  if(!secret||req.headers.authorization!==`Bearer ${secret}`)return json(res,401,{error:'Not authorized'});
  try{
    const s=db(),now=new Date();
    const {error:expireError}=await s.from('online_consultations').update({status:'payment_pending',hold_expires_at:null,updated_at:now.toISOString()}).eq('status','pending_payment').lt('hold_expires_at',now.toISOString());
    if(expireError)throw expireError;
    const soon=new Date(now.getTime()+55*60000),late=new Date(now.getTime()+70*60000);
    const {data:confirmed,error}=await s.from('online_consultations').select('id,appointment_date,appointment_time').eq('status','confirmed').gte('appointment_date',soon.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})).lte('appointment_date',late.toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})).limit(300);
    if(error)throw error;
    for(const c of confirmed||[]){const start=datetime(c.appointment_date,c.appointment_time);if(start>=soon&&start<=late){await s.from('online_consultation_email_jobs').upsert([{consultation_id:c.id,kind:'patient_reminder',state:'pending'},{consultation_id:c.id,kind:'clinic_reminder',state:'pending'}],{onConflict:'consultation_id,kind',ignoreDuplicates:true});}}
    const retention=new Date(now);retention.setUTCFullYear(retention.getUTCFullYear()-3);
    const draftCutoff=new Date(now.getTime()-90*86400000).toISOString();
    const {data:oldRecords,error:oldErr}=await s.from('online_consultations').select('id,uploaded_files').not('terminal_at','is',null).lt('terminal_at',retention.toISOString()).limit(50);if(oldErr)throw oldErr;
    const {data:oldDrafts,error:dErr}=await s.from('online_consultations').select('id,uploaded_files').in('status',['payment_pending','expired']).lt('created_at',draftCutoff).limit(50);if(dErr)throw dErr;
    for(const c of [...(oldRecords||[]),...(oldDrafts||[])]){const paths=(c.uploaded_files||[]).map(f=>f.path);if(paths.length){const {error:fileError}=await s.storage.from('consultation-reports').remove(paths);if(fileError)continue;}const {error:deleteError}=await s.from('online_consultations').delete().eq('id',c.id);if(deleteError)continue;}
    const {data:jobs,error:jErr}=await s.from('online_consultation_email_jobs').select('id').in('state',['pending','failed']).lt('attempt_count',6).order('updated_at').limit(100);if(jErr)throw jErr;
    let delivered=0;for(const job of jobs||[])if(await sendJob(job))delivered++;
    json(res,200,{expired_holds:true,reminder_candidates:(confirmed||[]).length,retained_records_deleted:(oldRecords||[]).length,drafts_deleted:(oldDrafts||[]).length,email_jobs:(jobs||[]).length,emails_sent:delivered});
  }catch(e){json(res,500,{error:'Consultation reminder job failed'});}
};
