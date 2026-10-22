// Pure handler with injected Auth clients so failure ordering is tested offline.
export function deletionHandler({allowedOrigins,verifyUser,prepareDeletion,deleteUser}) {
 return async request=>{
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(origin&&allowedOrigins.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'});
  const reply=(status,message)=>new Response(JSON.stringify({message}),{status,headers});
  if(origin&&!allowedOrigins.includes(origin))return reply(403,'Origin not allowed');
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,'Use POST');
  const token=request.headers.get('authorization');
  if(!/^Bearer \S+$/.test(token||''))return reply(401,'Sign in again');
  let body;try{body=await request.json();}catch{return reply(400,'Invalid request');}
  if(body.confirm!=='DELETE MY ACCOUNT')return reply(400,'Explicit deletion confirmation required');
  try{
   // The user ID comes exclusively from verified Supabase Auth, never the body/JWT decode.
   const user=await verifyUser(token);if(!user?.id)return reply(401,'Sign in again');
   await prepareDeletion(token); // SQL checks fresh OTP, ownership, locks and revokes access.
   await deleteUser(user.id); // Service role stays in this Edge Function only.
   return reply(200,'Account deleted. Golf results have been preserved.');
  }catch(error){return reply(409,error?.message||'Deletion could not finish. Sign in again and retry.');}
 };
}
