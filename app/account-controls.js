/* Account controls share the verified Supabase session; no credentials are persisted. */
(() => {
 'use strict';
 if(!['deploy-preview-6--super-quokka-51747d.netlify.app','localhost','127.0.0.1'].includes(location.hostname))return;
 let api=null;
 window.iigAccount={
  configure(value){api=value;},
  close(){document.getElementById('iigAccountDialog')?.remove();},
  open(){
   if(!api)return;
   this.close();const dialog=document.createElement('div');dialog.id='iigAccountDialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','My account');
   dialog.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:12000;overflow:auto;padding:24px';
   dialog.innerHTML='<div class="card" style="max-width:520px;margin:0 auto"><h2>My account</h2><p>Sign in with the same verified email to recover access on another device. For a lost email address, contact I’m In Golf; a group PIN cannot recover an account.</p><p id="accountMessage" role="status" aria-live="polite"></p><button id="accountOwner" class="secondary full">Open my organiser controls</button><button id="accountPlayer" class="secondary full">Open my player account</button><label for="accountName">Your player name</label><input id="accountName" maxlength="80" autocomplete="name"><label for="accountHandicap">Handicap</label><input id="accountHandicap" inputmode="decimal" placeholder="11.2"><details><summary>Change my email</summary><p>Supabase will send confirmation links. Confirm the change from both your current and new inboxes, then sign out and sign in with the new email.</p><label for="accountNewEmail">New email</label><input id="accountNewEmail" type="email" autocomplete="off"><button id="accountChangeEmail" class="secondary full">Send email change confirmations</button></details><details><summary>Transfer group ownership</summary><p>The new organiser must already be a verified group member. Both accounts must have signed in with a fresh email code within ten minutes. Share the acceptance code privately with that member. Transferring group administration does not transfer an Apple subscription: the purchaser must manage it in Apple Settings.</p><label for="accountTransferEmail">New organiser’s email</label><input id="accountTransferEmail" type="email" autocomplete="off"><button id="accountTransfer" class="secondary full">Create ownership transfer</button><label for="accountTransferToken">Acceptance code</label><input id="accountTransferToken" autocomplete="off"><button id="accountAcceptTransfer" class="secondary full">Accept ownership transfer</button></details><details><summary>Delete my account</summary><p>Transfer any group you own first. Your login and membership will be removed. Saved golf results are retained so other players’ history stays intact. Sign in with a fresh email code within ten minutes before deleting.</p><label for="accountDeleteConfirm">Type DELETE MY ACCOUNT</label><input id="accountDeleteConfirm" autocomplete="off"><button id="accountDelete" class="danger full">Delete my account</button></details><button id="accountClose" class="ghost full">Close</button></div>';
   document.body.appendChild(dialog);
   const get=id=>dialog.querySelector('#'+id),note=text=>get('accountMessage').textContent=text;
   if(api.canSwitch===false){for(const id of ['accountOwner','accountPlayer','accountName','accountHandicap'])get(id).hidden=true;dialog.querySelectorAll('[for=accountName],[for=accountHandicap]').forEach(el=>el.hidden=true);}
   let busy=false;
   async function run(fn){if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);note('Please wait…');try{await fn();}catch(error){note(error.message||'Please try again.');}finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}}
   get('accountClose').onclick=()=>this.close();
   get('accountOwner').onclick=()=>run(async()=>{await api.openOrganiser();this.close();});
   get('accountPlayer').onclick=()=>run(async()=>{const name=get('accountName').value.trim(),raw=get('accountHandicap').value.trim();if(!name||!/^[-]?[0-9]{1,2}(?:\.[0-9])?$/.test(raw)||Number(raw)<-10||Number(raw)>60)throw Error('Enter your name and a handicap from -10 to 60.');await api.openPlayer(name,Number(raw));this.close();});
   get('accountChangeEmail').onclick=()=>run(async()=>{const email=get('accountNewEmail').value.trim();if(!/^[^\s@]+@[^\s@]+[.][^\s@]+$/.test(email))throw Error('Enter your new email address.');await api.request('/auth/v1/user?redirect_to='+encodeURIComponent(location.origin+'/app/'),{email},true);note('Confirm both emailed links, then sign out and sign in with your new email.');});
   get('accountTransfer').onclick=()=>run(async()=>{const token=await api.request('/rest/v1/rpc/iig_request_owner_transfer',{p_email:get('accountTransferEmail').value.trim()},true);get('accountTransferToken').value=token;note('Transfer created. Share this acceptance code privately with the named member. It expires in 24 hours.');});
   get('accountAcceptTransfer').onclick=()=>run(async()=>{const token=get('accountTransferToken').value.trim();if(!/^[0-9a-f-]{36}$/i.test(token))throw Error('Enter the complete acceptance code.');const pin=await api.request('/rest/v1/rpc/iig_accept_owner_transfer',{p_token:token},true);note('Ownership accepted for group '+pin+'. Open my organiser controls to continue.');});
   get('accountDelete').onclick=()=>run(async()=>{if(get('accountDeleteConfirm').value!=='DELETE MY ACCOUNT')throw Error('Type DELETE MY ACCOUNT to confirm.');await api.request('/functions/v1/account-delete',{confirm:'DELETE MY ACCOUNT'},true);api.reset();this.close();});
   get('accountClose').focus();
  }
 };
})();
