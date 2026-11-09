// ONLINE CONSULTATIONS: shared Node 22 CommonJS server helpers.
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

let client;
function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Server Supabase configuration is missing');
  if (!client) client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
function json(res, status, data) { res.setHeader('Content-Type','application/json; charset=utf-8'); res.setHeader('Cache-Control','no-store'); res.status(status).json(data); }
function method(req, res, allowed) { if (!allowed.includes(req.method)) { res.setHeader('Allow',allowed.join(', ')); json(res,405,{error:'Method not allowed'}); return false; } return true; }
async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks=[]; for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function text(value, max, required=false) {
  if (typeof value !== 'string') { if (required) throw new Error('Invalid request'); return ''; }
  const s=value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
  if ((required && !s) || s.length>max) throw new Error('Invalid request');
  return s;
}
function validUuid(v) { return typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
function email(v) { const s=text(v,254,true).toLowerCase(); if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s)) throw new Error('Invalid email'); return s; }
function phone(v) { const s=text(v,20,true); if (!/^[+0-9][0-9 -]{7,14}$/.test(s) || s.replace(/\D/g,'').length<8) throw new Error('Invalid phone'); return s; }
function hash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function token() { return crypto.randomBytes(32).toString('hex'); }
function makeMeetingUrl() {
  const provider=(process.env.MEETING_PROVIDER||'jitsi').toLowerCase();
  if (provider==='jitsi') { const room=crypto.randomBytes(16).toString('base64url').slice(0,16); return `https://${process.env.JITSI_DOMAIN||'meet.jit.si'}/NV-${room}`; }
  throw new Error('Unsupported meeting provider; update makeMeetingUrl to configure it');
}
function reference() { return `NV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function safeFileName(v) { return text(v,180,true).replace(/[\\/]/g,'_'); }
function escapeHtml(v) { return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function istDateTime(date,time) { return new Date(`${date}T${String(time).slice(0,8)}+05:30`); }
function formatIst(date,time) { return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(istDateTime(date,time))+' IST'; }
async function getUser(req) {
  const m=String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i); if(!m) return null;
  const {data,error}=await db().auth.getUser(m[1]); return error?null:data.user;
}
async function isAdmin(req) {
  const user=await getUser(req); if(!user?.email) return null;
  const {data,error}=await db().from('admins').select('email').ilike('email',user.email).maybeSingle();
  return error||!data?null:user;
}
async function ownsDraft(req, consult, draftToken) {
  const user=await getUser(req);
  if(user && consult.user_id && user.id===consult.user_id) return true;
  if(!consult.user_id && typeof draftToken==='string' && /^[a-f0-9]{64}$/i.test(draftToken)) {
    const expected=Buffer.from(consult.access_token_hash,'hex'), actual=Buffer.from(hash(draftToken),'hex');
    return expected.length===actual.length && crypto.timingSafeEqual(expected,actual);
  }
  return false;
}
async function rateLimit(req) {
  const ip=String(req.headers['x-forwarded-for']||req.headers['x-real-ip']||'unknown').split(',')[0].trim().slice(0,100);
  const secret=process.env.CRON_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key=crypto.createHmac('sha256',secret).update(ip).digest('hex');
  const {data,error}=await db().rpc('allow_online_consult_request',{p_key_hash:key});
  if(error) throw error;
  return data===true;
}
async function getFee() {
  const {data,error}=await db().from('online_consultation_settings').select('fee_paise').eq('singleton',true).single();
  if(error) throw error; return Number(data.fee_paise);
}
async function razorpay(path, options={}) {
  if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET) throw new Error('Server payment configuration is missing');
  const auth=Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const r=await fetch(`https://api.razorpay.com/v1/${path}`,{...options,headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/json',...(options.headers||{})}});
  const data=await r.json().catch(()=>({})); if(!r.ok){const error=new Error(data.error?.description||'Payment provider request failed');error.status=r.status;throw error} return data;
}
async function createRazorpayOrder(consult) {
  if(!Number.isInteger(Number(consult.amount_paise))||Number(consult.amount_paise)<100) throw new Error('Payment amount must be at least 100 paise');
  return razorpay('orders',{method:'POST',body:JSON.stringify({amount:consult.amount_paise,currency:'INR',receipt:consult.reference.slice(0,40),notes:{consultation_id:consult.id,reference:consult.reference}})});
}
async function paymentDetails(paymentId) { return razorpay(`payments/${encodeURIComponent(paymentId)}`,{method:'GET'}); }
async function signUploadLinks(consultId, files) {
  const out=[];
  for(const f of files||[]) {
    const path=f.path||`${consultId}/${crypto.randomUUID()}`;
    const {data,error}=await db().storage.from('consultation-reports').createSignedUploadUrl(path);
    if(error) throw error;
    out.push({name:f.name,path,token:data.token,contentType:f.type});
  }
  return out;
}
async function findConsultation(id) {
  if(!validUuid(id)) return null;
  const {data,error}=await db().from('online_consultations').select('*').eq('id',id).maybeSingle();
  if(error) throw error; return data;
}
async function createJobs(consultationId, kinds) {
  const rows=kinds.map(kind=>({consultation_id:consultationId,kind,state:'pending'}));
  const {error}=await db().from('online_consultation_email_jobs').upsert(rows,{onConflict:'consultation_id,kind',ignoreDuplicates:true});
  if(error) throw error;
}
async function sendMail(to,subject,html,jobId,attachments=[]) {
  const clinic=process.env.CLINIC_EMAIL;
  if(clinic!=='niranjans@nilamburvaidyasala.com'||!process.env.RESEND_API_KEY) throw new Error('Server email configuration is missing');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`online-consult-${jobId}`},body:JSON.stringify({from:`Nilambur Vaidyasala <${clinic}>`,to:[to],reply_to:clinic,subject,html,attachments})});
  const data=await r.json().catch(()=>({})); if(!r.ok) throw new Error(data.message||'Email provider request failed'); return data;
}
function questionnaireSummary(q) {
  const labels={mainComplaint:'Main complaint',duration:'Duration',severity:'Severity',medicines:'Current medicines',allergies:'Allergies',conditions:'Past conditions or surgeries',pregnancy:'Pregnancy',extras:'Additional answers'};
  return Object.entries(labels).map(([k,label])=>{const v=q?.[k];if(v===undefined||v===null||v==='')return '';const value=typeof v==='object'?JSON.stringify(v):String(v);return `<p><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}</p>`}).filter(Boolean).join('');
}
function mailDetails(c) {
  const when=formatIst(c.appointment_date,c.appointment_time),join=escapeHtml(c.meeting_url);
  return {when,join,subjectClinic:`[${c.doctor_name}] Online consultation, ${when.replace(' IST','')} (${c.reference})`,subjectPatient:`Online consultation · ${when} · ${c.reference}`};
}
async function sendJob(job) {
  const s=db();
  const {data:claimed,error:claimError}=await s.rpc('claim_online_consult_email_job',{p_job_id:job.id});
  if(claimError) throw claimError;
  const row=Array.isArray(claimed)?claimed[0]:claimed; if(!row) return false;
  try {
    const c=await findConsultation(row.consultation_id); if(!c) throw new Error('Consultation not found');
    const {when,join,subjectClinic,subjectPatient}=mailDetails(c);
    const patient=String(row.kind).includes('patient');
    const reminder=String(row.kind).includes('reminder');
    const report=String(row.kind).startsWith('patient_report_');
    const paymentConflict=String(row.kind)==='clinic_payment_conflict';
    let subject,html,to,attachments=[];
    if(patient) {
      to=c.patient_email; subject=report?`Consultation report · ${c.reference} · ${c.payment_status==='paid'?'Payment Confirmed':'Payment Pending'}`:(reminder?`Online consultation reminder · ${when} · ${c.reference}`:subjectPatient);
      if(report){html=`<p>Your consultation report is attached.</p><p>Appointment: ${escapeHtml(when)} with ${escapeHtml(c.doctor_name)}.</p><p>Payment status: <b>${c.payment_status==='paid'?'Payment Confirmed':'Payment Pending'}</b>.</p><p>If payment is pending, review your saved consultation and retry payment from the consultation page.</p>`;attachments=[{filename:`${c.reference}-consultation-report.html`,content:Buffer.from(c.report_html||'').toString('base64'),content_type:'text/html'}]}
      else html=reminder?`<p>This is a reminder for your online consultation with ${escapeHtml(c.doctor_name)} on ${escapeHtml(when)}.</p><p><a href="${join}">Join consultation</a></p><p>Reference ${escapeHtml(c.reference)}.</p>`:`<p>Your online consultation with ${escapeHtml(c.doctor_name)} is confirmed for ${escapeHtml(when)}.</p><p>Reference: ${escapeHtml(c.reference)}</p><p>Payment status: <b>Payment Confirmed</b>.</p><p><a href="${join}">Join consultation</a></p><p>Please join 10 minutes before the appointment.</p>`;
    } else {
      to=process.env.CLINIC_EMAIL; subject=reminder?`[${c.doctor_name}] Online consultation reminder, ${when.replace(' IST','')} (${c.reference})`:subjectClinic;
      if(reminder) html=`<p>Reminder: ${escapeHtml(c.patient_name)} has an online consultation with ${escapeHtml(c.doctor_name)} at ${escapeHtml(when)}.</p><p><a href="${join}">Meeting link</a></p>`;
      else if(paymentConflict){subject=`[${c.doctor_name}] Payment received; appointment needs attention (${c.reference})`;html=`<p>A payment was received for ${escapeHtml(c.patient_name)}'s consultation, but the original time ${escapeHtml(when)} could not be confirmed.</p><p>Review this consultation in the admin dashboard and arrange another time or mark the payment refunded in Razorpay.</p><p>Reference: ${escapeHtml(c.reference)}</p>`;}
      else {
        const reportUrl=`${process.env.APP_URL||'https://nilamburvaidyasala.com'}/admin.html?tab=online&reference=${encodeURIComponent(c.reference)}`;
        html=`<p>Patient: ${escapeHtml(c.patient_name)}, age ${Number(c.age)}.</p><p>Phone: ${escapeHtml(c.phone)} · Email: ${escapeHtml(c.patient_email)}</p>${questionnaireSummary(c.questionnaire)}<p>Reports: <a href="${escapeHtml(reportUrl)}">Open reports in the admin dashboard</a></p><p>Meeting: <a href="${join}">${join}</a></p>`;
      }
    }
    await sendMail(to,subject,html,row.id,attachments);
    const {error}=await s.rpc('finish_online_consult_email_job',{p_job_id:row.id,p_success:true,p_error:null}); if(error) throw error;
    return true;
  } catch(e) {
    await s.rpc('finish_online_consult_email_job',{p_job_id:row.id,p_success:false,p_error:String(e.message||e)});
    return false;
  }
}
async function sendConsultationJobs(id) {
  const {data,error}=await db().from('online_consultation_email_jobs').select('id').eq('consultation_id',id).in('state',['pending','failed']);
  if(error) throw error;
  for(const job of data||[]) await sendJob(job);
}
module.exports={crypto,db,json,method,body,text,email,phone,validUuid,hash,token,makeMeetingUrl,reference,safeFileName,escapeHtml,istDateTime,formatIst,getUser,isAdmin,ownsDraft,rateLimit,getFee,razorpay,createRazorpayOrder,paymentDetails,signUploadLinks,findConsultation,createJobs,sendJob,sendConsultationJobs};
