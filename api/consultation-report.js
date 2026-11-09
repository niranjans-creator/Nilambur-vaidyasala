// ONLINE CONSULTATIONS: idempotently generates a patient-facing report.
const {db,json,method,body,validUuid,findConsultation,ownsDraft,isAdmin,escapeHtml,formatIst,createJobs,sendConsultationJobs}=require('./_consult');

function reportHtml(c){
  const q=c.questionnaire||{};
  const payment=c.payment_status==='paid'?'Payment Confirmed':'Payment Pending';
  const when=c.appointment_date&&c.appointment_time?formatIst(c.appointment_date,c.appointment_time):'Appointment time not selected';
  const rows=[['Consultation focus',q.consultationFocus],['Main complaint',q.mainComplaint],['Duration',q.duration],['Severity',q.severity],['Current medicines',q.medicines],['Allergies',q.allergies],['Past conditions or surgeries',q.conditions],['Pregnancy',q.pregnancy],['Liver screening answers',q.liver&&JSON.stringify(q.liver)],['Additional answers',q.extras&&JSON.stringify(q.extras)]]
    .filter(([,v])=>v!==undefined&&v!==null&&String(v).trim()!=='')
    .map(([k,v])=>`<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consultation report ${escapeHtml(c.reference)}</title><style>body{font:15px/1.5 Arial,sans-serif;color:#243226;max-width:760px;margin:40px auto;padding:0 20px}h1{color:#3a4a20;margin-bottom:4px}.meta{color:#68786d}.status{display:inline-block;padding:8px 14px;border-radius:999px;background:${payment==='Payment Confirmed'?'#e5f2df':'#fff0d6'};color:#3a4a20;font-weight:700}table{border-collapse:collapse;width:100%;margin-top:24px}th,td{border:1px solid #dfe8d8;padding:10px;text-align:left;vertical-align:top}th{width:34%;background:#f5f9f1}.notice{margin-top:24px;padding:14px;background:#f5f9f1;border-radius:10px}</style></head><body><h1>Medical consultation report</h1><p class="meta">Nilambur Vaidyasala · Reference ${escapeHtml(c.reference)}</p><p class="status">${payment}</p><h2>Appointment</h2><p><b>Doctor:</b> ${escapeHtml(c.doctor_name)}<br><b>Department:</b> ${escapeHtml(c.department)}<br><b>Date and time:</b> ${escapeHtml(when)}<br><b>Patient:</b> ${escapeHtml(c.patient_name)} · ${Number(c.age)} years · ${escapeHtml(c.gender)}</p><h2>Questionnaire</h2><table>${rows}</table><p class="notice">This report records the information submitted for the consultation. It is not an emergency service or a substitute for an in-person examination.</p></body></html>`;
}

module.exports=async function(req,res){
  if(!method(req,res,['POST']))return;
  try{
    const b=await body(req);if(!validUuid(String(b.consultation_id||'')))return json(res,400,{error:'Consultation is missing'});
    const c=await findConsultation(b.consultation_id);if(!c)return json(res,404,{error:'Consultation not found'});
    const admin=await isAdmin(req);if(!admin&&!await ownsDraft(req,c,b.draft_token))return json(res,403,{error:'You cannot access this report'});
    const html=reportHtml(c),now=new Date().toISOString();
    if(c.report_html!==html||!c.report_generated_at){const {error}=await db().from('online_consultations').update({report_html:html,report_generated_at:now,updated_at:now}).eq('id',c.id);if(error)throw error;await db().from('online_consultation_events').insert({consultation_id:c.id,status:'report_generated',note:`${c.payment_status==='paid'?'Payment Confirmed':'Payment Pending'} report generated`});await createJobs(c.id,[`patient_report_${c.payment_status==='paid'?'confirmed':'pending'}`]);await sendConsultationJobs(c.id).catch(()=>{});}
    json(res,200,{reference:c.reference,status:c.payment_status==='paid'?'Payment Confirmed':'Payment Pending',html,generated_at:c.report_generated_at||now});
  }catch(e){json(res,500,{error:'Could not generate the consultation report'});}
};
