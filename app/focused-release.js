/* Scoped presentation for the focused account release. No activation/configuration here. */
(() => {
 'use strict';
 if(!window.IIG_ACCOUNT_ACCESS||window.IIG_ACCOUNT_BUILD?.release!=='focused-v1')return;
 const active=()=>!!window.iigSecurePlayer?.active||!!window.iigSecureOrganiser?.active;
 function entered(player){
  if(!player||!active())return false;
  const entry=accountEntryStatus();
  if(entry?.closed)return Array.isArray(entry.entrantIds)&&entry.entrantIds.includes(player.id);
  if(state.trip?.active){const ids=state.trip.currentPlayingIds??state.trip.playerIds;return Array.isArray(ids)&&ids.includes(player.id);}
  const recorded=player.stableford!=null||player.netScore!=null||player.noReturn===true;
  if(state.gameType==='points')return player.playingThisRound===true||recorded;
  return Number(state.stake||0)<=0||player.paid===true||player.playingThisRound===true||recorded;
 }
 function paymentIsExplicitlyUnpaid(player){
  const response=player?.paymentDeclaration;
  return active()&&state.gameType==='money'&&Number(state.stake||0)>0&&response?.status==='not-paid'&&response.roundId===String(state.roundId||'');
 }
 function paymentBlocksInitialScore(player){
  return paymentIsExplicitlyUnpaid(player)&&player.scoreSubmitted!==true&&player.noReturn!==true&&player.stableford==null&&player.netScore==null;
 }
 function canPayEntry(player){
  return state.roundOpen===true&&state.gameType==='money'&&Number(state.stake||0)>0&&entered(player);
 }
 window.IIGRelease={entered,paymentIsExplicitlyUnpaid,paymentBlocksInitialScore,canPayEntry,get active(){return active();}};
 const next=playerNextActionHtml;
 playerNextActionHtml=function(){
  const paidEntry=window.IIGPaidEntry?.nextActionHtml();if(paidEntry!=null)return paidEntry;
  if(!window.iigSecurePlayer?.active||state.gameType!=='money'||state.roundOpen!==true||!tripPlayerIsPlaying(state.players.find(p=>p.id===myPlayerId)))return next();
  const me=state.players.find(p=>p.id===myPlayerId);if(!me)return next();
  if(!entered(me))return roundLocked()?next():'<div class="card"><button class="primary full" onclick="enterNormalPointsGame()">I’m playing</button><p>You can confirm payment after submitting your score.</p></div>';
  return '<div class="card"><button class="primary full" onclick="show(\'scores\')">'+(me.scoreSubmitted||me.noReturn||me.stableford!=null||me.netScore!=null?'View my locked score':'Enter my score')+'</button>'+(me.paid?'':'<p>Entry fee still due. Open Pay to confirm whether you’ve paid.</p>')+'</div>';
 };
 // The original payment launcher rejects closed entry; settlement uses the same
 // validated HTTPS provider link, without mutating entry, score or history.
 // Offer a user-initiated fallback regardless of window.open's return value.
 // noopener can return null even when a new window successfully opens.
 window.iigReleasePay=async function(){
  if(!window.iigSecurePlayer?.active){showAppToast('Sign in to pay','Reopen your group, then try Pay again.');return;}
  const me=state.players.find(p=>p.id===myPlayerId);
  if(!canPayEntry(me)){document.getElementById('iigPaymentLaunchHelp')?.remove();showAppToast('No entry payment available','Open Round to check the current competition.');return;}
  if(!entered(me)){showAppToast('You are not entered','Open Round to check your entry before paying.');return;}
  let url;
  try{url=new URL(String(state.paymentLink||''));if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)(monzo\.me|monzo\.com|paypal\.me|paypal\.com|revolut\.me|revolut\.com|starlingbank\.com|wise\.com)$/.test(url.hostname))throw Error();}
  catch(_){showAppToast('Payment link unavailable','Ask your organiser how to pay.');return;}
  const context={pin:String(pin||''),player:myPlayerId,round:String(state.roundId||''),link:String(state.paymentLink||'')};
  const screen=document.getElementById('screen');
  if(!screen){showAppToast('Open Pay again','The payment screen is not ready.');return;}
  document.getElementById('iigPaymentLaunchHelp')?.remove();
  const panel=document.createElement('section');panel.id='iigPaymentLaunchHelp';panel.className='card';panel.setAttribute('aria-labelledby','iigPaymentLaunchTitle');
  const title=document.createElement('h2');title.id='iigPaymentLaunchTitle';title.textContent='Opening your payment link';panel.append(title);
  const note=document.createElement('p');note.textContent='If the payment page didn’t open, use the link below or copy it into your browser.';panel.append(note);
  const current=()=>{
   const player=state.players.find(p=>p.id===myPlayerId);
   const valid=window.iigSecurePlayer?.active&&context.pin===String(pin||'')&&context.player===myPlayerId&&context.round===String(state.roundId||'')&&context.link===String(state.paymentLink||'')&&canPayEntry(player);
   if(!valid){panel.remove();showAppToast('Payment details changed','Reopen Pay to use the current payment link.');}
   return !!valid;
  };
  const link=document.createElement('a');link.id='iigPaymentDirectLink';link.className='primary full';link.href=url.href;link.target='_self';link.rel='noreferrer';link.style.display='block';link.style.textAlign='center';link.style.marginBottom='10px';link.textContent='Open payment page';
  link.addEventListener('click',event=>{if(!current())event.preventDefault();});panel.append(link);
  const copy=document.createElement('button');copy.type='button';copy.className='secondary full';copy.textContent='Copy payment link';panel.append(copy);
  const status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
  const manual=document.createElement('input');manual.type='text';manual.readOnly=true;manual.hidden=true;manual.value=url.href;manual.setAttribute('aria-label','Payment link to copy');panel.append(manual);
  copy.addEventListener('click',async()=>{
   if(!current())return;
   try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(url.href);if(current()&&panel.isConnected)status.textContent='Link copied. Paste it into your browser.';}
   catch(_){if(current()&&panel.isConnected){manual.hidden=false;manual.focus();manual.select();status.textContent='Select and copy the payment link below.';}}
  });
  const reminder=document.createElement('p');reminder.textContent='After paying, return to I’m In Golf and confirm you’ve paid. If money has already left your account, don’t pay again.';panel.append(reminder);
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='secondary full';dismiss.textContent='Back to Pay';dismiss.addEventListener('click',()=>panel.remove());panel.append(dismiss);
  screen.prepend(panel);
  panel.iigContextIsCurrent=current;
  try{window.open(url.href,'_blank','noopener,noreferrer');}
  catch(_){title.textContent='Open your payment link';}
  // Do not automatically navigate a second time: a null return is ambiguous.
  panel.scrollIntoView?.({block:'nearest'});
 };

})();
