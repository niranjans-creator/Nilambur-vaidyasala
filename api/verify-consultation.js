// ONLINE CONSULTATIONS: verifies Razorpay's checkout signature and server-fetched payment.
const {db,json,method,body,validUuid,paymentDetails,sendConsultationJobs}=require('./_consult');
const crypto=require('node:crypto');
module.exports=async function(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const b=await body(req),id=String(b.consultation_id||''),orderId=String(b.razorpay_order_id||''),paymentId=String(b.razorpay_payment_id||''),signature=String(b.razorpay_signature||'');
    if(!validUuid(id)||!/^order_[A-Za-z0-9]+$/.test(orderId)||!/^pay_[A-Za-z0-9]+$/.test(paymentId)||! /^[a-f0-9]{64}$/i.test(signature))return json(res,400,{error:'Invalid payment confirmation'});
    const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET||'').update(`${orderId}|${paymentId}`).digest();
    const received=Buffer.from(signature,'hex');if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected))return json(res,400,{error:'Payment could not be verified'});
    const [{data:attempt,error:aErr},{data:c,error:cErr}]=await Promise.all([
      db().from('online_consultation_payments').select('consultation_id,razorpay_order_id,amount_paise').eq('razorpay_order_id',orderId).maybeSingle(),
      db().from('online_consultations').select('id,reference,doctor_name,appointment_date,appointment_time,meeting_url').eq('id',id).maybeSingle()
    ]);
    if(aErr||cErr)throw aErr||cErr;if(!attempt||!c||attempt.consultation_id!==id||attempt.razorpay_order_id!==orderId)return json(res,400,{error:'Payment could not be verified'});
    const payment=await paymentDetails(paymentId);
    if(payment.order_id!==orderId||Number(payment.amount)!==Number(attempt.amount_paise)||payment.currency!=='INR'||payment.status!=='captured')return json(res,400,{error:'Payment could not be verified'});
    const {data:confirmed,error}=await db().rpc('confirm_online_consultation_payment',{p_order_id:orderId,p_payment_id:paymentId,p_amount_paise:Number(payment.amount),p_currency:payment.currency});
    if(error)throw error;if(!confirmed)return json(res,400,{error:'Payment could not be matched to this consultation'});
    if(confirmed.payment_conflict){await sendConsultationJobs(attempt.consultation_id).catch(()=>{});return json(res,409,{error:'Payment received. The clinic will contact you to arrange another time.'});}
    await sendConsultationJobs(attempt.consultation_id).catch(()=>{});
    json(res,200,{status:'confirmed',reference:c.reference,doctor:c.doctor_name,date:c.appointment_date,time:String(c.appointment_time).slice(0,5),timezone:'Asia/Kolkata',meeting_url:c.meeting_url});
  }catch(e){json(res,500,{error:'Payment verification is pending. Your confirmation will arrive by email.'});}
};
