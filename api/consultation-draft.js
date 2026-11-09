// ONLINE CONSULTATIONS: validates and stores the health questionnaire before payment.
const {db,json,method,body,text,email,phone,validUuid,token,hash,reference,makeMeetingUrl,signUploadLinks,rateLimit,findConsultation,ownsDraft,getFee,getUser}=require('./_consult');
const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp','application/pdf']);
module.exports=async function(req,res){
  if(!method(req,res,['POST']))return;
  let old=null;
  try{
    if(!await rateLimit(req))return json(res,429,{error:'Please wait before starting another consultation'});
    const b=await body(req),doctorId=String(b.doctor_id||'');
    if(!validUuid(doctorId))return json(res,400,{error:'Choose a doctor'});
    if(b.consultation_id){if(!validUuid(b.consultation_id))return json(res,400,{error:'Invalid consultation draft'});old=await findConsultation(b.consultation_id);if(!old||!await ownsDraft(req,old,b.draft_token))return json(res,404,{error:'Consultation draft not found'});if(['confirmed','completed','no_show','cancelled'].includes(old.status)||old.payment_status==='paid')return json(res,409,{error:'This consultation can no longer be edited'});}
    const {data:doctor,error:dErr}=await db().from('doctors').select('id,name,dept,qualification').eq('id',doctorId).maybeSingle();
    if(dErr||!doctor)return json(res,400,{error:'Choose a currently listed doctor'});
    const a=b.answers||{},redFlags=Array.isArray(a.redFlags)?a.redFlags:[];
    if(redFlags.length)return json(res,409,{error:'This service is not for emergencies. For chest pain, breathing difficulty, severe bleeding, stroke symptoms or loss of consciousness, go to the nearest hospital or call 112.',emergency:true});
    if(b.consent_privacy!==true||b.consent_telemedicine!==true)return json(res,400,{error:'Please accept both consent statements'});
    const age=Number(a.age);if(!Number.isInteger(age)||age<1||age>120)return json(res,400,{error:'Enter a valid age'});
    const gender=String(a.gender||'');if(!['female','male','nonbinary','prefer_not_to_say'].includes(gender))return json(res,400,{error:'Choose a gender option'});
    const patientName=text(a.name,120,true),patientPhone=phone(a.phone),patientEmail=email(a.email);
    const mainComplaint=text(a.mainComplaint,2000,true),duration=text(a.duration,200,true),severity=Number(a.severity);
    if(!Number.isInteger(severity)||severity<1||severity>10)return json(res,400,{error:'Choose a severity from 1 to 10'});
    const files=Array.isArray(b.files)?b.files:[];if(files.length>5)return json(res,400,{error:'Upload up to five reports'});
    const cleanFiles=files.map(f=>{const name=text(f.name,180,true),type=String(f.type||''),size=Number(f.size);if(!ALLOWED_TYPES.has(type)||!Number.isInteger(size)||size<1||size>5242880)throw new Error('Each report must be a PDF or image no larger than 5 MB');return{name,type,size};});
    const extras={};for(const [k,v] of Object.entries(a.extras||{})){if(typeof v==='string'&&v.trim())extras[text(k,40,true)]=text(v,1000);}
    const guardianName=age<18?text(a.guardianName,120,true):'';if(age<18&&a.guardianConsent!==true)return json(res,400,{error:'A parent or guardian must consent for patients under 18'});
    const questionnaire={mainComplaint,duration,severity,medicines:text(a.medicines||'',2000),allergies:text(a.allergies||'',2000),conditions:text(a.conditions||'',2000),pregnancy:text(a.pregnancy||'',40),extras,guardianName};
    const id=old?.id||require('node:crypto').randomUUID(),accessToken=old?b.draft_token:token(),fee_paise=await getFee();
    const storedFiles=cleanFiles.map(f=>({path:`${id}/${require('node:crypto').randomUUID()}`,name:f.name,type:f.type,size:f.size}));
    const links=await signUploadLinks(id,storedFiles),user=await getUser(req);
    const row={doctor_id:doctor.id,doctor_name:text(doctor.name,120,true),department:text(doctor.dept,120,true),qualification:text(doctor.qualification||'',120),patient_name:patientName,age,gender,phone:patientPhone,patient_email:patientEmail,questionnaire,uploaded_files:storedFiles,amount_paise:Number(fee_paise),status:'payment_pending',payment_status:'pending',updated_at:new Date().toISOString()};
    if(old){
      if(old.status==='pending_payment')await db().rpc('release_online_consultation_hold',{p_consultation_id:old.id});
      if(old.doctor_id!==doctor.id){row.appointment_date=null;row.appointment_time=null;}
      const {error}=await db().from('online_consultations').update(row).eq('id',id);if(error)throw error;
      if((old.uploaded_files||[]).length)await db().storage.from('consultation-reports').remove(old.uploaded_files.map(f=>f.path));
    }else{
      const sessionUser=user?.id||null;
      const {error}=await db().from('online_consultations').insert({...row,id,reference:reference(),user_id:sessionUser,access_token_hash:hash(accessToken),meeting_url:makeMeetingUrl()});if(error)throw error;
    }
    const c=old||await findConsultation(id);
    json(res,201,{consultation_id:id,reference:c.reference,draft_token:accessToken,uploads:links,fee_paise:Number(fee_paise),doctor:{id:doctor.id,name:row.doctor_name,qualification:row.qualification,department:row.department},doctor_id:doctor.id});
  }catch(e){json(res,400,{error:e.message==='Invalid request'||e.message==='Invalid phone'||e.message==='Invalid email'?e.message:(e.message||'Could not save consultation details')});}
};
