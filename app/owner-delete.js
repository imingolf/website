/* Owner deletion uses the existing verified session adapter. No credentials or group data are stored here. */
(function(root){
 'use strict';
 root.IIGOwnerDelete={create(api){
  let dialog=null,epoch=0;
  function close(){epoch++;if(dialog){dialog.close();dialog.remove();dialog=null;}}
  async function open(pin){
   if(!/^\d{4}$/.test(pin)||!api.userId())return;
   close();const stamp=epoch,actor=api.userId(),previous=document.activeElement;
   const box=document.createElement('dialog');dialog=box;box.className='owner-delete-dialog';
   box.setAttribute('aria-labelledby','ownerDeleteTitle');
   box.innerHTML='<h2 id="ownerDeleteTitle">Delete group permanently?</h2><p id="ownerDeleteGroup"></p><div id="ownerDeleteDetails"></div><p id="ownerDeleteStatus" role="status">Checking the selected group…</p><form id="ownerDeleteForm" hidden><label for="ownerDeleteConfirm" id="ownerDeleteLabel"></label><input id="ownerDeleteConfirm" autocomplete="off" spellcheck="false"><div class="owner-delete-actions"><button type="button" data-delete-cancel class="secondary">Cancel</button><button type="submit" id="ownerDeleteSubmit" class="owner-delete-danger" disabled>Delete group permanently</button></div></form><div id="ownerDeleteOther" class="owner-delete-actions"><button type="button" data-delete-cancel class="secondary">Cancel</button><button type="button" id="ownerDeleteVerify" class="primary" hidden>Email me a new code</button><button type="button" id="ownerDeleteRetry" class="secondary" hidden>Try again</button></div>';
   document.body.append(box);box.showModal();
   const $=id=>box.querySelector('#'+id);
   const current=()=>dialog===box&&box.isConnected&&stamp===epoch&&api.userId()===actor;
   let review=null,requestId=null,pending=false,done=false;
   box.querySelectorAll('[data-delete-cancel]').forEach(b=>b.onclick=()=>{close();if(previous?.isConnected)previous.focus();});
   box.addEventListener('cancel',event=>{if(pending)event.preventDefault();else close();});
   function lock(value){pending=value;box.querySelectorAll('button,input').forEach(el=>{el.disabled=value;});if(!value)$('ownerDeleteSubmit').disabled=!review||!review.can_delete||review.needs_verification||$('ownerDeleteConfirm').value!=='DELETE '+review.group_pin;}
   function valid(data){return data&&data.group_pin===pin&&/^\d+$/.test(data.group_id)&&/^[a-f0-9]{64}$/.test(data.fingerprint)&&typeof data.can_delete==='boolean'&&typeof data.needs_verification==='boolean'&&data.counts&&['players','history_entries','past_trips'].every(k=>Number.isSafeInteger(data.counts[k])&&data.counts[k]>=0);}
   async function load(note=''){
    if(!current())return;review=null;requestId=null;done=false;$('ownerDeleteForm').hidden=true;$('ownerDeleteOther').hidden=false;$('ownerDeleteVerify').hidden=true;$('ownerDeleteRetry').hidden=true;$('ownerDeleteConfirm').value='';$('ownerDeleteStatus').textContent='Checking the selected group…';lock(true);
    try{
     const data=await api.request('/rest/v1/rpc/iig_owner_group_deletion_review',{p_pin:pin});if(!current())return;if(!valid(data))throw Error('The group details could not be verified. Refresh and try again.');
     review=data;requestId=crypto.randomUUID();$('ownerDeleteGroup').textContent=(data.group_name||'Unnamed group')+' · PIN '+pin;
     const details=$('ownerDeleteDetails');details.replaceChildren();
     for(const value of [data.counts.players+' player records · '+data.counts.history_entries+' saved history entries · '+data.counts.past_trips+' past trips','This permanently removes this group, its current competition, scores, payments recorded in the app, trips, leagues, invitations and saved golf history. It cannot be undone.','Member sign-in accounts and their other groups are kept. This does not refund or cancel payments made outside the app.']){const p=document.createElement('p');p.textContent=value;details.append(p);}
     if(!data.can_delete){$('ownerDeleteStatus').textContent=data.blocked_reason||'This group cannot be deleted.';}
     else if(data.needs_verification){$('ownerDeleteStatus').textContent='For permanent deletion, verify a new email code. Then select this group again.';$('ownerDeleteVerify').hidden=false;}
     else{$('ownerDeleteStatus').textContent=note;$('ownerDeleteLabel').textContent='Type DELETE '+pin+' to confirm';$('ownerDeleteForm').hidden=false;$('ownerDeleteOther').hidden=true;}
    }catch(error){if(current()){$('ownerDeleteStatus').textContent=error.message||'Group details could not be loaded.';$('ownerDeleteRetry').hidden=false;}}
    finally{if(current()){lock(false);box.querySelector('[data-delete-cancel]:not([hidden])')?.focus();}}
   }
   $('ownerDeleteRetry').onclick=()=>load();
   $('ownerDeleteVerify').onclick=()=>{if(pending||!current())return;close();api.reauth();};
   $('ownerDeleteConfirm').oninput=()=>{if(!pending)lock(false);};
   $('ownerDeleteForm').onsubmit=async event=>{
    event.preventDefault();if(pending||done||!current()||!review?.can_delete||review.needs_verification||$('ownerDeleteConfirm').value!=='DELETE '+pin)return;
    lock(true);$('ownerDeleteStatus').textContent='Deleting this group…';
    try{
     const result=await api.request('/rest/v1/rpc/iig_owner_delete_group',{p_group_id:review.group_id,p_pin:pin,p_confirmation:$('ownerDeleteConfirm').value,p_fingerprint:review.fingerprint,p_request_id:requestId});
     if(!current())return;if(result?.deleted!==true||result.group_id!==review.group_id||result.request_id!==requestId)throw Error('The deletion result could not be confirmed.');
     done=true;$('ownerDeleteForm').hidden=true;$('ownerDeleteOther').hidden=false;$('ownerDeleteVerify').hidden=true;$('ownerDeleteRetry').hidden=true;$('ownerDeleteTitle').textContent='Group deleted';$('ownerDeleteStatus').textContent='The group and its golf history have been permanently deleted.';
     try{await api.refresh();}catch(_){if(current())$('ownerDeleteStatus').textContent='The group was deleted. Refresh the dashboard to update the list.';}
     if(current()){lock(false);box.querySelectorAll('[data-delete-cancel]').forEach(b=>{b.textContent='Close';});$('ownerDeleteOther').querySelector('[data-delete-cancel]').focus();}
    }catch(error){
     if(!current())return;
     if(error.code==='40001'){await load('The group changed. Review its latest details and type the confirmation again.');return;}
     if(error.code==='42501'){await load();return;}
     $('ownerDeleteStatus').textContent=(error.message||'The deletion result could not be confirmed.')+' If the connection failed, retrying this same request is safe.';
     lock(false);
    }
   };
   await load();
  }
  return {open,close};
 }};
})(window);
