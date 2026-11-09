// ONLINE CONSULTATIONS: admin-only doctor availability and fee configuration.
const {db,json,method,body,validUuid,isAdmin}=require('./_consult');
function validTime(t){return typeof t==='string'&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(t)}
module.exports=async function(req,res){
  const user=await isAdmin(req);if(!user)return json(res,403,{error:'Admin access required'});
  const s=db();
  try{
    if(req.method==='GET'){
      const [{data:doctors,error:dErr},{data:slots,error:sErr},{data:settings,error:fErr}]=await Promise.all([
        s.from('doctors').select('id,name,dept,qualification,photo_url').order('name'),
        s.from('doctor_online_slots').select('*').order('weekday').order('start_time'),
        s.from('online_consultation_settings').select('fee_paise').eq('singleton',true).single()
      ]);if(dErr||sErr||fErr)throw dErr||sErr||fErr;
      return json(res,200,{doctors,slots,fee_paise:settings.fee_paise});
    }
    if(!method(req,res,['GET','POST']))return;
    const b=await body(req);
    if(b.action==='fee'){
      const fee=Number(b.fee_paise);if(!Number.isInteger(fee)||fee<100||fee>10000000)return json(res,400,{error:'Enter a valid fee in paise'});
      const {error}=await s.from('online_consultation_settings').update({fee_paise:fee,updated_at:new Date().toISOString()}).eq('singleton',true);if(error)throw error;return json(res,200,{ok:true,fee_paise:fee});
    }
    if(b.action==='delete_slot'){
      if(!validUuid(b.id))return json(res,400,{error:'Invalid availability rule'});
      const {error}=await s.from('doctor_online_slots').delete().eq('id',b.id);if(error)throw error;return json(res,200,{ok:true});
    }
    if(b.action==='save_slot'){
      const weekday=Number(b.weekday),slot=Number(b.slot_minutes);
      if(!validUuid(b.doctor_id)||!Number.isInteger(weekday)||weekday<0||weekday>6||!validTime(b.start_time)||!validTime(b.end_time)||b.start_time>=b.end_time||![15,20].includes(slot))return json(res,400,{error:'Check doctor, day, time range and slot length'});
      const rule={doctor_id:b.doctor_id,weekday,start_time:b.start_time,end_time:b.end_time,slot_minutes:slot,is_active:b.is_active!==false};
      const result=b.id&&validUuid(b.id)?await s.from('doctor_online_slots').update(rule).eq('id',b.id).select('*').single():await s.from('doctor_online_slots').insert(rule).select('*').single();
      if(result.error)throw result.error;return json(res,200,{slot:result.data});
    }
    return json(res,400,{error:'Unknown settings action'});
  }catch(e){json(res,500,{error:'Could not update online consultation settings'});}
};
