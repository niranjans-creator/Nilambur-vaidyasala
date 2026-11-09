// ONLINE CONSULTATIONS: signed, idempotent Razorpay webhook backup path.
const {db,json,method,razorpay,paymentDetails,sendConsultationJobs}=require('./_consult');
const crypto=require('node:crypto');
async function rawBody(req){const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>1048576)throw new Error('Webhook too large');parts.push(p)}return Buffer.concat(parts)}
module.exports=async function(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const raw=await rawBody(req),signature=String(req.headers['x-razorpay-signature']||''),secret=process.env.RAZORPAY_WEBHOOK_SECRET||'';
    if(!secret||!/^[a-f0-9]{64}$/i.test(signature))return json(res,401,{error:'Invalid webhook signature'});
    const expected=crypto.createHmac('sha256',secret).update(raw).digest(),received=Buffer.from(signature,'hex');
    if(received.length!==expected.length||!crypto.timingSafeEqual(received,expected))return json(res,401,{error:'Invalid webhook signature'});
    const event=JSON.parse(raw.toString('utf8'));
    if(!['payment.captured','order.paid'].includes(event.event))return json(res,200,{received:true});
    let payment,orderId;
    if(event.event==='payment.captured'){
      payment=event.payload?.payment?.entity;orderId=payment?.order_id;
      if(!payment?.id||!orderId)return json(res,400,{error:'Incomplete payment event'});
    }else{
      const order=event.payload?.order?.entity;orderId=order?.id;if(!orderId)return json(res,400,{error:'Incomplete order event'});
      const results=await razorpay(`orders/${encodeURIComponent(orderId)}/payments`,{method:'GET'});
      payment=(results.items||[]).find(p=>p.status==='captured'&&p.order_id===orderId);
      if(!payment)return json(res,503,{error:'Paid order payment details are not ready'});
    }
    const {data:attempt,error}=await db().from('online_consultation_payments').select('consultation_id,amount_paise').eq('razorpay_order_id',orderId).maybeSingle();
    if(error)throw error;if(!attempt)return json(res,503,{error:'Payment attempt not yet recorded'});
    if(Number(payment.amount)!==Number(attempt.amount_paise)||payment.currency!=='INR')return json(res,400,{error:'Payment amount mismatch'});
    const {data:confirmed,error:cErr}=await db().rpc('confirm_online_consultation_payment',{p_order_id:orderId,p_payment_id:payment.id,p_amount_paise:Number(payment.amount),p_currency:payment.currency});
    if(cErr)throw cErr;if(!confirmed)return json(res,503,{error:'Payment attempt was not matched'});
    await sendConsultationJobs(attempt.consultation_id).catch(()=>{});
    json(res,200,{received:true,confirmed:!confirmed.payment_conflict});
  }catch(e){json(res,500,{error:'Webhook processing failed; provider may retry'});}
};

module.exports.config={api:{bodyParser:false}};
