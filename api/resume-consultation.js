// ONLINE CONSULTATIONS: reuses a saved draft and selected slot with a fresh Razorpay order.
const {db,json,method,body,validUuid,rateLimit,findConsultation,ownsDraft,createRazorpayOrder}=require('./_consult');
module.exports=async function(req,res){
  if(!method(req,res,['POST']))return;
  try{
    if(!await rateLimit(req))return json(res,429,{error:'Please wait before trying payment again'});
    const b=await body(req);if(!validUuid(b.consultation_id))return json(res,400,{error:'Consultation draft is missing'});
    const c=await findConsultation(b.consultation_id);if(!c||!await ownsDraft(req,c,b.draft_token))return json(res,404,{error:'Consultation draft not found'});
    if(c.payment_status==='paid')return json(res,409,{error:'This consultation is already paid'});
    if(!c.appointment_date||!c.appointment_time)return json(res,409,{error:'Choose an appointment time first',choose_time:true});
    const {data:reserved,error:rErr}=await db().rpc('reserve_online_consultation',{p_consultation_id:c.id,p_date:c.appointment_date,p_time:String(c.appointment_time).slice(0,5)});
    if(rErr)throw rErr;if(reserved!==true)return json(res,409,{error:'That time is no longer available. Choose another time.',slot_taken:true});
    const {data:held,error:hErr}=await db().from('online_consultations').select('*').eq('id',c.id).single();if(hErr)throw hErr;
    let order;try{order=await createRazorpayOrder(held);}catch(e){await db().rpc('release_online_consultation_hold',{p_consultation_id:c.id});throw e;}
    const {error:pErr}=await db().from('online_consultation_payments').insert({consultation_id:c.id,razorpay_order_id:order.id,amount_paise:held.amount_paise,state:'created'});
    if(pErr){await db().rpc('release_online_consultation_hold',{p_consultation_id:c.id});throw pErr;}
    const {error:uErr}=await db().from('online_consultations').update({razorpay_order_id:order.id,updated_at:new Date().toISOString()}).eq('id',c.id);if(uErr)throw uErr;
    json(res,200,{consultation_id:c.id,reference:c.reference,razorpay_order_id:order.id,amount:held.amount_paise,currency:'INR',key_id:process.env.RAZORPAY_KEY_ID,clinic_name:'Nilambur Vaidyasala',patient:{name:c.patient_name,email:c.patient_email,phone:c.phone}});
  }catch(e){json(res,500,{error:'Could not resume payment. Your answers are saved; please try again.'});}
};
