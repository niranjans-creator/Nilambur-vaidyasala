// ONLINE CONSULTATIONS: releases a checkout hold after a close or a failed payment.
const {db,json,method,body,validUuid,findConsultation,ownsDraft}=require('./_consult');
module.exports=async function(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const b=await body(req);if(!validUuid(b.consultation_id))return json(res,400,{error:'Consultation draft is missing'});
    const c=await findConsultation(b.consultation_id);if(!c||!await ownsDraft(req,c,b.draft_token))return json(res,404,{error:'Consultation draft not found'});
    await db().rpc('release_online_consultation_hold',{p_consultation_id:c.id});
    json(res,200,{status:'payment_pending'});
  }catch(e){json(res,500,{error:'Could not save payment status'});}
};
