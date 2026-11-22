/* Paid individual-round entry. All writes stay in the signed-in player adapter. */
(() => {
 'use strict';
 const kind='paid-entry-v1';
 let dialog=null,saving=false,checking=false;
 const me=()=>state.players?.find(p=>p.id===myPlayerId);
 const applicable=()=>!!window.iigSecurePlayer?.active&&window.IIG_ACCOUNT_BUILD?.release==='focused-v1'&&state.gameType==='money'&&Number(state.stake)>0&&!state.trip?.active;
 const entered=()=>window.IIGRelease?.entered(me())===true;
 const declaredPaid=()=>me()?.paid===true&&!window.IIGRelease?.paymentIsExplicitlyUnpaid(me());
 const scored=()=>!!(me()?.scoreSubmitted||me()?.noReturn||me()?.stableford!=null||me()?.netScore!=null);
 const amount=()=>Number(state.stake).toLocaleString('en-GB',{maximumFractionDigits:2});
 const pending=()=>{const j=readPaymentJourney();return j?.kind===kind?j:null;};
 const context=()=>({groupPin:String(pin||''),playerId:myPlayerId,roundId:String(state.roundId||''),course:String(state.course||''),roundDate:String(state.date||''),stake:Number(state.stake),paymentLink:String(state.paymentLink||'')});
 function same(j){const c=context();return applicable()&&j&&Object.keys(c).every(k=>j[k]===c[k]);}
 function isPending(){const j=pending();return !!(j&&same(j));}
 function clear(j){const stored=pending();if(stored&&stored.startedAt===j.startedAt&&stored.playerId===j.playerId&&stored.roundId===j.roundId)clearPaymentJourney();}
 function close(){if(dialog){dialog.close?.();dialog.remove();dialog=null;}}
 function detail(){return '<h3>'+esc(state.course)+'</h3><p class="muted">'+esc(formatDate(state.date))+' · '+esc(state.groupName||'')+'</p>';}
 function nextActionHtml(){
  if(!applicable()||state.roundOpen!==true)return null;
  if(!entered())return '<div class="card iig-paid-entry-next">'+(roundLocked()?'<h2>Entries closed</h2><p>You can join the next competition.</p>':(window.IIGRelease?.paymentIsExplicitlyUnpaid(me())?'<h2>You’re not entered yet</h2>':'')+'<p>Pay before you play.</p><button class="primary full" onclick="show(\'pay\')">Pay to enter</button>')+'</div>';
  if(declaredPaid())return '<div class="card iig-paid-entry-next"><h2>✓ You’re entered</h2><p>'+(scored()?'Your score has been saved.':'Enjoy your round. Enter your final score when you’ve finished.')+'</p><button class="primary full" onclick="show(\'scores\')">'+(scored()?'View leaderboard':'Enter score')+'</button></div>';
  return '<div class="card iig-paid-entry-next"><h2>You’re entered</h2><p>Entry fee due: £'+esc(amount())+'</p><button class="primary full" onclick="show(\'pay\')">Pay entry fee</button><button class="secondary full" onclick="show(\'scores\')">'+(scored()?'View my locked score':'Enter score')+'</button></div>';
 }
 function button(parent,label,fn,secondary=false){const b=document.createElement('button');b.type='button';b.className=(secondary?'secondary':'primary')+' full';b.textContent=label;b.addEventListener('click',fn);parent.append(b);return b;}
 function render(){
  if(!applicable()){close();return;}
  const screen=document.getElementById('screen');if(!screen)return;
  if(page==='round'){
   const card=[...screen.querySelectorAll('.card')].find(n=>n.querySelector('h2')?.textContent===state.course);
   const label=card?.querySelector('.muted');if(label)label.textContent=state.roundOpen===true?(roundLocked()?'ENTRIES CLOSED':'COMPETITION OPEN'):'CURRENT ROUND';
  }
  if(page==='pay'&&!screen.querySelector('[data-paid-entry]')){
   const previous=[...screen.children];
   screen.replaceChildren();
   const card=document.createElement('section');card.className='card iig-paid-entry';card.dataset.paidEntry='true';screen.append(card);
   if(state.roundOpen!==true){
    card.innerHTML='<h2>No competition is open</h2><p>Previous results and payment records are unchanged.</p>';
   }else if(!entered()&&roundLocked()){
    card.innerHTML='<h2>Entries closed</h2>'+detail()+'<p>You are not able to enter this competition now. If you have already paid, contact your organiser.</p>';
   }else if(declaredPaid()&&entered()){
    card.innerHTML='<h2>✓ You’re entered</h2>'+detail()+'<p>Payment confirmed.</p>';
    button(card,scored()?'View leaderboard':'Enter score',()=>show('scores'));
   }else{
    card.innerHTML='<h2>'+(entered()?'Pay entry fee':'Pay to enter')+'</h2><div class="iig-entry-details">'+detail()+'<p class="iig-entry-price">£'+esc(amount())+' <span>to '+(entered()?'pay':'enter')+'</span></p></div><p>Pay using the organiser’s payment link, then return here to confirm.</p>';
    button(card,'Open payment link',launch);
    if(entered())button(card,'I’ve already paid',()=>window.iigSecurePlayer.confirmExistingPayment(),true);
    const status=document.createElement('p');status.id='iigEntryMessage';status.setAttribute('role','status');card.append(status);
   }
   button(card,'Back to round',()=>show('round'),true);
   // Keep existing group totals and payment list available, without repeating entry actions.
   const groupCards=previous.filter(n=>n.classList?.contains('card')&&!n.id&&(n.querySelector('.player')||n.querySelector('.big')));
   if(groupCards.length){const group=document.createElement('details');group.className='card ui-fold';const summary=document.createElement('summary');summary.textContent='Group payments';group.append(summary);for(const n of groupCards)group.append(n);screen.append(group);}
  }
  resume();
 }
 function message(text){const node=document.getElementById('iigEntryMessage');if(node)node.textContent=text;else showAppToast('Competition entry',text,4500);}
 function validLink(){
  const url=new URL(paymentLinkForStake(String(state.paymentLink||''),state.stake));
  if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)(monzo\.me|monzo\.com|paypal\.me|paypal\.com|revolut\.me|revolut\.com|starlingbank\.com|wise\.com)$/.test(url.hostname))throw Error('Ask your organiser for a payment link.');
  return url.href;
 }
 function launch(){
  if(!applicable()||saving||checking)return;
  if(isPending()){resume();return;}
  if(!window.iigSecurePlayer.paymentReady){message('Reload your group before paying.');return;}
  if(state.roundOpen!==true||(!entered()&&roundLocked())){message('Entries are closed. Do not make a new payment.');return;}
  let href;try{href=validLink();}catch(error){message(error.message);return;}
  if(!state.roundId){message('Reload your group before paying.');return;}
  const journey={kind,...context(),startedAt:Date.now(),wasEntered:entered()};
  rememberPaymentJourney(journey);
  try{
   const saved=JSON.parse(localStorage.getItem(paymentReturnKey())||'null');
   if(saved?.startedAt!==journey.startedAt||saved?.playerId!==journey.playerId)throw Error();
  }catch(_){clear(journey);message('The app could not remember your payment. Reopen it and try again before paying.');return;}
  showQuestion(journey,href);
  try{window.open(href,'_blank','noopener,noreferrer');}
  catch(_){setStatus('Use “Open payment link again” below if the payment page did not open.');}
 }
 function setStatus(text){const n=dialog?.querySelector('[data-entry-status]');if(n)n.textContent=text;}
 function setBusy(value){saving=value;for(const b of dialog?.querySelectorAll('button')||[])b.disabled=value;}
 function showQuestion(j,href){
  if(dialog||!same(j))return;
  dialog=document.createElement('dialog');dialog.className='iig-entry-dialog';dialog.setAttribute('aria-labelledby','iigEntryQuestion');
  dialog.innerHTML='<h2 id="iigEntryQuestion">Have you paid £'+esc(amount())+'?</h2><p>'+esc(state.course)+'</p><p>Confirm your payment to '+(entered()?'update your entry fee.':'enter the competition.')+'</p><p data-entry-status role="status" aria-live="polite"></p>';
  dialog.addEventListener('cancel',event=>event.preventDefault());
  button(dialog,'I’ve paid',()=>answer(true,j));
  button(dialog,'I’ve not paid',()=>answer(false,j),true);
  const recovery=document.createElement('details');recovery.className='iig-entry-recovery';const summary=document.createElement('summary');summary.textContent='Payment link didn’t open?';recovery.append(summary);
  const info=document.createElement('p');info.textContent='If money has already left your account, don’t pay again.';recovery.append(info);
  if(href){const link=document.createElement('a');link.className='secondary full';link.textContent='Open payment link again';link.href=href;link.target='_self';link.rel='noopener noreferrer';link.addEventListener('click',event=>{if(!same(j)||state.roundOpen!==true||(!entered()&&roundLocked())){event.preventDefault();setStatus('The competition changed. Check your entry before paying.');}});recovery.append(link);}
  dialog.append(recovery);document.body.append(dialog);dialog.showModal();
 }
 function changed(j){
  close();clear(j);message('The competition or payment details changed. Your payment has not been recorded here. Contact your organiser if money has left your account.');
 }
 async function answer(confirmed,j){
  if(saving||checking||!same(j))return;
  setBusy(true);setStatus('Checking your entry…');
  try{
   const ready=await window.iigSecurePlayer.reloadForPayment();
   if(!same(j)){changed(j);return;}
   if(!ready){setStatus('Couldn’t check your entry. Your answer is still pending. Try again when connected.');return;}
   if(confirmed&&declaredPaid()&&entered()){finish(j,true);return;}
   if(state.roundOpen!==true||(!entered()&&roundLocked())){closed(j);return;}
   setStatus('Saving your answer…');
   const saved=await window.iigSecurePlayer.recordEntryPayment(confirmed,j);
   if(!same(j)){changed(j);return;}
   const response=me()?.paymentDeclaration;
   const verified=response?.roundId===j.roundId&&response.status===(confirmed?'paid':'not-paid')&&(!confirmed||(declaredPaid()&&entered()));
   if(!saved||!verified){setStatus('Your answer could not be confirmed. It is still pending. Tap your answer again to check and retry.');return;}
   finish(j,confirmed);
  }finally{setBusy(false);}
 }
 function finish(j,confirmed){clear(j);close();show('round');if(!confirmed)showAppToast(entered()?'Payment still due':'You’re not entered yet',entered()?'Your existing entry has been kept.':'Pay and confirm “I’ve paid” to enter this competition.',4000);}
 function closed(j){
  close();
  dialog=document.createElement('dialog');dialog.className='iig-entry-dialog';dialog.setAttribute('aria-labelledby','iigEntryClosed');
  const existing=j.wasEntered||entered();
  dialog.innerHTML='<h2 id="iigEntryClosed">Entries have closed</h2><p>'+(existing?'Your existing entry and score are unchanged. No new payment response has been saved.':'Your entry has not been confirmed.')+' If you paid, contact your organiser about your payment.</p>';
  dialog.addEventListener('cancel',e=>e.preventDefault());button(dialog,'Back to round',()=>{clear(j);close();show('round');},true);document.body.append(dialog);dialog.showModal();
 }
 function resume(){
  const j=pending();if(!j||!applicable()||saving||checking)return false;
  if(!same(j)){close();if(j.groupPin===String(pin)&&j.playerId===myPlayerId)changed(j);return false;}
  if(!Number.isFinite(j.startedAt)||Date.now()-j.startedAt>48*3600000){changed(j);return false;}
  if(dialog)return true;
  if(state.roundOpen!==true){closed(j);return true;}
  let href;try{href=validLink();}catch(_){}
  showQuestion(j,href);return true;
 }
 window.IIGPaidEntry={applicable,pending:isPending,render,resume,launch,nextActionHtml,close};
})();
