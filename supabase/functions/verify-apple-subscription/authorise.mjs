// Verified Apple data is supplied by the server's authenticated Apple API request.
export async function activateVerifiedSubscription({admin,verifyUser,authorization,groupPin,transaction,allowSandbox=false,now=Date.now()}) {
 if(transaction.environment==='Sandbox'&&!allowSandbox)throw Error('Sandbox subscriptions are restricted to the test project');
 if(!/^\d{4}$/.test(groupPin)||!transaction.originalTransactionId||!Number.isFinite(Number(transaction.expiresDate))||Number(transaction.expiresDate)<=now||transaction.revocationDate)throw Error('Subscription is not active');
 const protectedResult=await admin.rpc('iig_is_protected_group',{p_pin:groupPin});
 if(protectedResult.error)throw Error('Subscription authorisation update is required');
 let userId=null;
 if(protectedResult.data===true){
  if(!/^Bearer \S+$/.test(authorization||''))throw Error('Sign in as your group organiser before upgrading');
  const user=await verifyUser(authorization);if(!user?.id)throw Error('Sign in as your group organiser before upgrading');userId=user.id;
  if(String(transaction.appAccountToken||'').toLowerCase()!==String(user.id).toLowerCase())throw Error('This purchase does not belong to your verified account');
 }
 const {data,error}=await admin.rpc('iig_apply_verified_subscription',{p_pin:groupPin,p_user_id:userId,p_original_id:String(transaction.originalTransactionId),p_expires_at:new Date(Number(transaction.expiresDate)).toISOString()});
 if(error||data!==true)throw Error(error?.message||'Subscription could not be linked');
 return true;
}
