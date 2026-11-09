// ONLINE CONSULTATIONS: doctor list is read live from public.doctors.
const {db,json,method,getFee}=require('./_consult');
module.exports=async function(req,res){
  if(!method(req,res,['GET'])) return;
  try{
    const [{data:doctors,error},{fee}]=await Promise.all([
      db().from('doctors').select('id,name,dept,qualification,photo_url').order('name'),
      getFee().then(fee=>({fee}))
    ]);
    if(error) throw error;
    json(res,200,{doctors:doctors||[],fee_paise:fee});
  }catch(e){json(res,500,{error:'Could not load online consultation options'});}
};
