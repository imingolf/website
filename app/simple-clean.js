/* Presentation helpers. Never read tokens, call APIs, or change gameplay state. */
(() => {
 'use strict';
 const defaultAppName=document.querySelector('.ui-app-name')?.textContent||'I’m In Golf';
 const folded=new WeakSet();
 const folds=new Map([
  ['Edit round details','Round details'],['Competition','Competition'],
  ['Side Game','Side game'],['Player payments','Payment settings'],['Play a side game','Side game']
 ]);
 function compactBanner(id,reloadId,summaryText){
  const banner=document.getElementById(id);if(!banner)return;
  const reload=document.getElementById(reloadId);
  const options=[...banner.querySelectorAll(':scope > details')].find(d=>d.querySelector(id==='securePlayerBanner'?'#securePlayerAccount':'#secureOrganiserAccount'));
  if(options&&reload&&reload.parentElement===banner){
   const summary=options.querySelector('summary');summary.textContent=summaryText;summary.after(reload);
  }
  const status=banner.querySelector(':scope > p[role="status"]');
  if(options&&/failed|could not|not confirmed|before continuing|account changed|sign in again|blocked/i.test(status?.textContent||''))options.open=true;
 }
 function polish(screen){
  const currentPage=typeof page==='string'?page:'';document.body.dataset.uiPage=currentPage;
  const groupName=typeof state==='object'&&state?state.groupName:'';
  const players=typeof state==='object'&&state&&Array.isArray(state.players)?state.players:null;
  const members=players?new Set(players.filter(p=>p&&p.id!=null&&String(p.id).trim()).map(p=>String(p.id))).size:null;
  const memberLabel=members===null?'':members+' '+(members===1?'member':'members');
  const brand=document.querySelector('.ui-app-name');
  const brandLabel=groupName?groupName+(memberLabel?' · '+memberLabel:''):defaultAppName;
  if(brand&&brand.textContent!==brandLabel)brand.textContent=brandLabel;
  for(const id of ['secureOrganiserBanner','securePlayerBanner']){
   const banner=document.getElementById(id);if(!banner)continue;
   const status=banner.querySelector('p[role=status]');
   const problem=/failed|could not|not confirmed|before continuing|account changed|sign in again|blocked/i.test(status?.textContent||'');
   banner.classList.toggle('ui-quiet-banner',!problem);
  }
  const playerBanner=document.getElementById('securePlayerBanner');
  const header=document.querySelector('.app-header-brand');
  if(playerBanner&&header&&!document.getElementById('uiPlayerOptions')){
   const button=document.createElement('button');button.id='uiPlayerOptions';button.className='secondary';button.textContent='Options';button.setAttribute('aria-expanded','false');
   button.onclick=()=>window.iigPlayerAccess?.toggleGroup(playerBanner);header.append(button);
  }
  // Presentation-only membership label: count the current group's unique player IDs.
  for(const badge of document.querySelectorAll('#screen .iig-member-count')){
   if(!memberLabel||badge.previousElementSibling?.textContent.trim()!==groupName)badge.remove();
  }
  if(groupName&&memberLabel){
   for(const el of document.querySelectorAll('#screen .notice b')){
    if(el.textContent.trim()===groupName){
     let badge=el.nextElementSibling;
     if(!badge?.classList.contains('iig-member-count')){badge=document.createElement('span');badge.className='iig-member-count muted';el.after(badge);}
     if(badge.textContent!==' · '+memberLabel)badge.textContent=' · '+memberLabel;
    }
   }
  }
  const groupBanner=document.getElementById('secureOrganiserBanner')||document.getElementById('securePlayerBanner');
  const groupPanel=groupBanner?.querySelector('#secureOrganiserAccount, #securePlayerAccount')?.closest('details.ui-options');
  if(groupPanel&&!groupPanel.querySelector('#iigGroupHelp')){
   const card=document.createElement('div');card.id='iigGroupHelp';card.className='card';
   const button=document.createElement('button');button.type='button';button.className='secondary full';button.textContent='❓ Group Help';card.append(button);
   const panel=document.createElement('div');panel.hidden=true;
   const heading=document.createElement('h2');heading.textContent='Group Help';panel.append(heading);
   const intro=document.createElement('p');intro.textContent='Tap a topic to read it. Tap again to close.';panel.append(intro);
   for(const [topic,label] of [['setup','Set up a competition'],['players','Players, handicaps & invitations'],['payments','Payment settings'],['prizes','Prize split'],['finish','Finish a competition'],['reminder','Share a reminder']]){
    const detail=document.createElement('details');detail.className='ui-options';const summary=document.createElement('summary');summary.textContent=label;detail.append(summary);
    const body=document.createElement('div');body.innerHTML=adminHelpTopicContent(topic);body.querySelector('h2')?.remove();detail.append(body);panel.append(detail);
   }
   const contact=document.createElement('h3');contact.textContent='Still need help?';panel.append(contact);
   const choice=document.createElement('select');choice.setAttribute('aria-label','Help request type');
   for(const label of ['Ask for help','Report a problem','Send feedback']){const option=document.createElement('option');option.value=label;option.textContent=label;choice.append(option);}panel.append(choice);
   const email=document.createElement('input');email.type='email';email.placeholder='Your email (for a reply)';email.setAttribute('aria-label','Your email for a reply');panel.append(email);
   const message=document.createElement('textarea');message.rows=4;message.placeholder='Tell us how we can help';message.setAttribute('aria-label','Your message');panel.append(message);
   const send=document.createElement('button');send.type='button';send.className='primary full';send.textContent='Open email to send';send.onclick=()=>{
    if(!message.value.trim()||!/^\S+@\S+\.\S+$/.test(email.value.trim())){alert('Please enter your email and a message.');return;}
    const subject="I'm In Golf — "+choice.value;
    const body='Group: '+String(state?.groupName||'')+'\nGroup PIN: '+String(typeof pin==='string'?pin:'')+'\nReply email: '+email.value.trim()+'\n\n'+message.value.trim();
    location.href='mailto:hello@imingolf.co.uk?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
   };panel.append(send);
   const note=document.createElement('p');note.className='muted';note.textContent='Opens your email app. Please press Send there to deliver your message to I’m In Golf support.';panel.append(note);
   button.onclick=()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));};button.setAttribute('aria-expanded','false');
   card.append(panel);groupPanel.append(card);
  }
  if(!screen)return;
  const me=typeof state==='object'?state.players?.find(p=>p.id===myPlayerId):null;
  if(currentPage==='pay'&&!window.IIGPaidEntry?.applicable()&&state.roundOpen===true&&window.iigSecurePlayer?.active&&me&&!screen.querySelector('#uiOwnPayment')){
   const card=document.createElement('div');card.id='uiOwnPayment';card.className='card ui-own-payment';
   const title=document.createElement('h2');title.textContent='Your entry fee';card.append(title);
   const status=document.createElement('p');status.setAttribute('role','status');
   const paidRound=state.gameType==='money'&&Number(state.stake||0)>0,entered=window.IIGRelease?.entered(me)===true;
   status.textContent=state.roundOpen!==true?'No competition is open.':!paidRound?'No payment needed.':!entered?'You are not entered in this round.':me.paid&&!window.IIGRelease?.paymentIsExplicitlyUnpaid(me)?'Paid · Eligible':'Entry fee due · You are entered';card.append(status);
   if(state.roundOpen===true&&paidRound&&entered){const help=document.createElement('p');help.className='muted';help.textContent=(me.scoreSubmitted||me.stableford!=null||me.netScore!=null||me.noReturn)?'Your submitted score remains locked.':'Confirm your payment status below.';card.append(help);}
   for(const [id,label] of [['securePlayerPayLink','Open payment link'],['securePlayerNotPaid','I haven’t paid']]){const source=document.getElementById(id);if(!source||source.hidden)continue;const button=document.createElement('button');button.type='button';button.className='secondary full';button.textContent=label;button.onclick=()=>{if(!source.hidden&&!source.disabled)source.click();};card.append(button);}
   screen.prepend(card);
  }
  // Proxy only an existing, visible authorised action; all confirmation and write checks remain in its original handler.
  const payment=document.getElementById('securePlayerConfirmPayment');
  if(currentPage==='pay'&&!window.IIGPaidEntry?.applicable()&&payment&&!payment.hidden&&!screen.querySelector('#uiConfirmEntryPayment')){
   const card=screen.querySelector('.card');if(card){const button=document.createElement('button');button.id='uiConfirmEntryPayment';button.className='primary full';button.textContent='I’ve paid my entry';button.onclick=()=>{if(!payment.hidden&&!payment.disabled)payment.click();};card.insertBefore(button,card.querySelector('button.secondary'));}
  }
  const ownPayment=screen.querySelector('#uiOwnPayment');
  if(currentPage==='pay'&&ownPayment&&state.gameType==='money'&&Number(state.stake||0)>0&&window.IIGRelease?.entered(me)&&roundLocked()&&(me.scoreSubmitted||me.noReturn||me.stableford!=null||me.netScore!=null)){
   for(const card of [...screen.children])if(card!==ownPayment&&card.classList.contains('card')&&card.querySelector('h2')?.textContent==='Entry payment')card.remove();
   if(!ownPayment.querySelector('#uiPayBackRound')){const back=document.createElement('button');back.id='uiPayBackRound';back.type='button';back.className='secondary full';back.textContent='Back to round';back.onclick=()=>show('round');ownPayment.append(back);}
   const groupCards=[...screen.children].filter(card=>card!==ownPayment&&card.id!=='iigPaymentLaunchHelp'&&card.classList.contains('card'));
   if(groupCards.length){let group=ownPayment.querySelector('#uiScoredGroupPayments');if(!group){group=document.createElement('details');group.id='uiScoredGroupPayments';group.className='ui-fold';const summary=document.createElement('summary');summary.textContent='Group payments';group.append(summary);ownPayment.append(group);}for(const card of groupCards)group.append(card);}
  }
  if(['roundhistory','winner'].includes(currentPage)){
   const payout=screen.querySelector('.ui-result-payment');if(payout&&screen.lastElementChild!==payout)screen.append(payout);
  }
  for(const notification of screen.querySelectorAll('.ui-notifications'))if(!notification.querySelector('details')){const details=document.createElement('details');details.className='ui-fold';const summary=document.createElement('summary');summary.textContent='Notifications & help';details.append(summary);while(notification.firstChild)details.append(notification.firstChild);notification.append(details);}
  if(currentPage==='roundhistory'){
   const empty=[...screen.querySelectorAll('.muted')].find(el=>el.textContent.trim()==='No result details saved.');
   if(empty&&[...screen.querySelectorAll('h2')].some(el=>/standings/i.test(el.textContent)))empty.closest('.card')?.setAttribute('hidden','');
  }
  for(const button of screen.querySelectorAll('button:disabled'))if(/entries closed/i.test(button.textContent)&&!button.nextElementSibling?.classList.contains('ui-entry-explanation')){
   const note=document.createElement('p');note.className='muted ui-entry-explanation';note.textContent='You can still join the group. Entry to this round is closed.';button.after(note);
  }
  const cards=[...screen.children].filter(el=>el.classList.contains('card'));
  const course=cards.find(el=>el.querySelector('h2')?.textContent=== (typeof state==='object'?state.course:''));
  if(currentPage==='round'&&course){
   course.classList.add('ui-course-summary');if(screen.firstElementChild!==course)screen.prepend(course);
   const next=document.getElementById('uiRoundNext');if(next&&course.nextElementSibling!==next)course.after(next);
   const totals=document.getElementById('uiRoundTotals'),payments=document.getElementById('uiRoundPayments');if(totals&&payments){while(totals.firstChild)payments.append(totals.firstChild);totals.remove();}
   const trip=cards.find(el=>el.textContent.includes('TRIP MODE'));
   if(trip&&!course.querySelector('.ui-trip-summary')){const text=document.createElement('p');text.className='ui-trip-summary';text.textContent=trip.innerText.replace(/✈️|TRIP MODE/g,'').replace(/\s+/g,' ').trim();course.prepend(text);trip.hidden=true;}
   for(const card of cards)if(/MANAGING:/.test(card.textContent))card.hidden=true;
  }
 }

 function decorate(){
  const paymentHelp=document.getElementById('iigPaymentLaunchHelp');
  if(paymentHelp&&(page!=='pay'||!window.IIGRelease?.canPayEntry(state.players?.find(p=>p.id===myPlayerId))||paymentHelp.iigContextIsCurrent?.()===false))paymentHelp.remove();
  const setup=document.getElementById('setupOverlay'),app=document.querySelector('.app');
  if(setup&&app){const opening=!setup.classList.contains('hidden');app.inert=opening;app.setAttribute('aria-hidden',String(opening));}
  compactBanner('secureOrganiserBanner','secureOrganiserReload','Group options');
  compactBanner('securePlayerBanner','securePlayerReload','Player options');
  const screen=document.getElementById('screen');polish(screen);
  if(screen){
   for(const heading of screen.querySelectorAll('.card > h2')){
    const text=heading.textContent.replace(/^[^\p{L}\p{N}]+/u,'').trim();
    if(!folds.has(text)||folded.has(heading.parentElement))continue;
    const card=heading.parentElement;folded.add(card);
    const details=document.createElement('details');details.className='ui-fold';
    const summary=document.createElement('summary');summary.textContent=folds.get(text);details.append(summary);
    heading.remove();while(card.firstChild)details.append(card.firstChild);card.append(details);
   }
   const primary=screen.querySelectorAll('button.primary');
   if(primary.length>1)for(const button of primary){
    // Navigation/help remain reachable, but do not compete with golf actions.
    if(/^(?:❓\s*)?(?:Organiser guide|View payments|Manage payments)$/i.test(button.textContent.trim()))button.classList.add('ui-secondary-action');
   }
  }
  for(const input of document.querySelectorAll('input:not([type=hidden]),select,textarea')){
   if(input.labels?.length||input.hasAttribute('aria-label')||input.hasAttribute('aria-labelledby'))continue;
   const previous=input.previousElementSibling;
   if(previous?.matches('label'))input.setAttribute('aria-label',previous.textContent.trim());
  }
  const nav=document.querySelector('.app > nav');
  if(nav){nav.setAttribute('aria-label','Golf navigation');for(const button of nav.querySelectorAll('button')){
   if(button.classList.contains('active'))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  }}
  for(const button of document.querySelectorAll('.comp-choice button,#tripCompStableford,#tripCompNet,#tripPointsOn,#tripPointsOff')){
   button.setAttribute('aria-pressed',String(button.classList.contains('selected')||button.classList.contains('primary')));
  }
 }
 window.iigDecorateLive=decorate;
 const main=document.querySelector('main');
 if(main)new MutationObserver(decorate).observe(main,{childList:true,subtree:true,characterData:true});
 new MutationObserver(decorate).observe(document.body,{childList:true});
 const setup=document.getElementById('setupOverlay');
 if(setup)new MutationObserver(decorate).observe(setup,{attributes:true,attributeFilter:['class']});
 document.addEventListener('click',()=>queueMicrotask(decorate));
 decorate();
})();
