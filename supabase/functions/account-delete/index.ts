import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {deletionHandler} from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL')!;
if(new URL(url).hostname!=='nyavvwrsrxqfyhiygkgw.supabase.co')throw Error('Staging account deletion is restricted to the test project');
const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const userClient=(authorization:string)=>createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(deletionHandler({
 allowedOrigins:(Deno.env.get('IIG_ALLOWED_ORIGINS')||'https://deploy-preview-6--super-quokka-51747d.netlify.app').split(',').map(x=>x.trim()),
 verifyUser:async(token:string)=>{const {data,error}=await userClient(token).auth.getUser();if(error)throw Error('Sign in again');return data.user;},
 prepareDeletion:async(token:string)=>{const {data,error}=await userClient(token).rpc('iig_prepare_account_deletion');if(error)throw Error(error.message);if(data!==true)throw Error('Deletion not authorised');},
 deleteUser:async(id:string)=>{const {error}=await admin.auth.admin.deleteUser(id);if(error)throw Error('Account access is disabled; deletion could not finish. Retry this request.');}
}));
