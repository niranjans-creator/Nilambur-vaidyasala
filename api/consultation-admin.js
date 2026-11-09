// ONLINE CONSULTATIONS: authenticated admin-only queue and operations.
const {db,json,method,body,text,validUuid,isAdmin,createJobs,sendConsultationJobs,crypto}=require('./_consult');
module.exports=async function(req,res){
  const user=await isAdmin(req);if(!user)return json(res,403,{error:'Admin access required'});
  const s=db();
  try{
    if(req.method==='GET'){
      let q=s.from('online_consultations').select('*').order('appointment_date',{ascending:true}).order('appointment_time',{ascending:true}).limit(300);
      const status=String(req.query.status||''),doctor=String(req.query.doctor_id||''),date=String(req.query.date||''),reference=String(req.query.reference||'');
      if(status&&['payment_pending','pending_payment','payment_conflict','confirmed','completed','no_show','cancelled','expired'].includes(status))q=q.eq('status',status);
      if(doctor&&validUuid(doctor))q=q.eq('doctor_id',doctor);
      if(/^\d{4}-\d{2}-\d{2}$/.test(date))q=q.eq('appointment_date',date);
      if(reference)q=q.eq('reference',reference.slice(0,20));
      const {data,error}=await q;if(error)throw error;
      const ids=(data||[]).map(x=>x.id);
      const {data:payments,error:pErr}=ids.length?await s.from('online_consultation_payments').select('consultation_id,razorpay_order_id,razorpay_payment_id,amount_paise,state,created_at').in('consultation_id',ids):{data:[],error:null};if(pErr)throw pErr;
      const paymentMap={};for(const p of payments||[])(paymentMap[p.consultation_id]??=[]).push(p);
      const rows=[];
      for(const c of data||[]){const files=[];for(const f of c.uploaded_files||[]){const {data:link,error:linkErr}=await s.storage.from('consultation-reports').createSignedUrl(f.path,600);files.push({name:f.name,type:f.type,size:f.size,url:linkErr?null:link?.signedUrl});}
        rows.push({...c,uploaded_files:files,payments:paymentMap[c.id]||[]});}
      return json(res,200,{consultations:rows});
    }
    if(req.method!=='POST')return method(req,res,['GET','POST']);
    const b=await body(req),id=String(b.consultation_id||'');if(!validUuid(id))return json(res,400,{error:'Invalid consultation'});
    const {data:c,error}=await s.from('online_consultations').select('id,status,payment_status').eq('id',id).maybeSingle();if(error)throw error;if(!c)return json(res,404,{error:'Consultation not found'});
    if(b.action==='resend_email'){
      const key=crypto.randomUUID();await createJobs(id,[`resend_patient_${key}`,`resend_clinic_${key}`]);await sendConsultationJobs(id);return json(res,200,{ok:true});
    }
    if(b.action==='status'&&['completed','no_show','cancelled'].includes(b.status)){
      const note=text(b.reason||`Marked ${b.status} by clinic`,500);
      const {data:updated,error:uErr}=await s.from('online_consultations').update({status:b.status,cancellation_reason:b.status==='cancelled'?note:null,terminal_at:new Date().toISOString(),hold_expires_at:null,updated_at:new Date().toISOString()}).eq('id',id).in('status',['confirmed','payment_pending','pending_payment']).select('id').maybeSingle();
      if(uErr)throw uErr;if(!updated)return json(res,409,{error:'This consultation can no longer be changed'});
      await s.from('online_consultation_events').insert({consultation_id:id,status:b.status,note});return json(res,200,{ok:true});
    }
    if(b.action==='reschedule'){
      const {data:ok,error:rErr}=await s.rpc('reschedule_online_consultation',{p_consultation_id:id,p_date:b.date,p_time:b.time});if(rErr)throw rErr;if(!ok)return json(res,409,{error:'That time is no longer available'});return json(res,200,{ok:true});
    }
    if(b.action==='mark_refunded'){
      if(!['paid'].includes(c.payment_status))return json(res,409,{error:'This payment cannot be marked refunded'});
      const {error:uErr}=await s.from('online_consultations').update({payment_status:'refunded',updated_at:new Date().toISOString()}).eq('id',id);if(uErr)throw uErr;
      await s.from('online_consultation_payments').update({state:'refunded'}).eq('consultation_id',id).in('state',['paid','refund_required']);
      return json(res,200,{ok:true});
    }
    return json(res,400,{error:'Unknown admin action'});
  }catch(e){json(res,500,{error:'Could not process consultation admin request'});}
};
