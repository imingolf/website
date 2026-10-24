/* Novice task guide. Fictional in-memory controls; never used in the real app. */
(() => {
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const hosted=document.querySelector('meta[name="iig-hosted-demo"]');if(!hosted)return;
  const $=id=>document.getElementById(id),friend=new URLSearchParams(location.search).get('scenario')==='friend';
  const guide=document.createElement('section');guide.id='demo-task-guide';guide.className='card';guide.setAttribute('aria-label','Practice task');
  guide.innerHTML='<h2>Your practice task</h2><p id="demo-task-copy"></p><p id="demo-task-help" role="status" aria-live="polite"></p><div id="demo-practice-actions"><button id="demo-add-friends" class="secondary full" hidden>Add fictional friends for this round</button><button id="demo-other-scores" class="secondary full" hidden>Simulate the other players’ scores</button><button id="demo-become-organiser" class="secondary full" hidden>Continue as organiser — demonstration</button><button id="demo-view-scores" class="secondary full" hidden>Go to Scores</button><button id="demo-view-results" class="secondary full" hidden>Go to League / Previous rounds</button></div><div class="demo-task-links"><button id="demo-feedback" class="ghost full">Give feedback</button><button id="demo-tasks" class="ghost full">Choose another task / start again</button></div>';
  document.body.insertBefore(guide,$('setupOverlay'));
  const move=()=>{const overlay=$('setupOverlay');const anchor=overlay&&!overlay.classList.contains('hidden')?$('welcomeHome'):document.querySelector('#screen');if(anchor&&guide.nextElementSibling!==anchor)anchor.before(guide);};
  function hide(id,value){const node=$(id);if(node&&node.hidden!==value)node.hidden=value;}
  function update(){
   move();const p=IIG_DEMO.practice.snapshot(),signed=!!(window.iigSecureOrganiser?.active||window.iigSecurePlayer?.active);
   hide('demo-add-friends',!(signed&&p?.owner&&p.roundOpen&&p.submitted===0&&p.players<3));
   hide('demo-other-scores',!(signed&&p?.roundOpen&&p.submitted<p.entered&&(p.owner||p.mySubmitted)));
   hide('demo-become-organiser',!(signed&&p&&!p.owner&&p.mySubmitted&&p.roundOpen));
   hide('demo-view-scores',!(signed&&p?.roundOpen));
   hide('demo-view-results',!(signed&&p?.history));
   const text=!p?(friend?'Join this fictional group as Jamie Green. Use jamie@example.test and code 123456. Enter a name and handicap, then join.':'Create a group using made-up details, for example Alex Taylor, Weekend Demo Golfers and alex@example.test. Use code 123456; no email arrives.'):
    !signed?'Your group is ready. Try Invite friends, then Create first competition. You can add yourself under “I’m playing too”.':
    p.history?'Round complete. Open League → Previous rounds and view the saved result. Then give feedback, or try the other task.':
    !p.roundOpen?'Invite your friends, then create a first competition. Use a fictional course, choose today and leave the entry fee at zero.':
    !p.owner&&!p.mySubmitted?'Tap “I’m Playing” on Round, then open Scores and submit your final Stableford points (try 35). You do not need hole-by-hole scores.':
    !p.owner?'Your score is saved. In the real app the organiser finishes the round. Use the clearly labelled demonstration switch below to try that next.':
    p.players<3&&p.submitted===0?'The competition is ready. Add fictional friends below, then go to Scores. Submit your own practice score (try 35); you can simulate the other players’ scores.':
    p.submitted<p.entered?'Go to Scores and submit your practice total. The simulation button fills only the other players’ totals. Once all scores are in, Finish Round appears at the bottom of Scores.':
    'All scores are in. Go to Scores, tap Finish Round to save the result. Then open League → Previous rounds.';
   if($('demo-task-copy').textContent!==text)$('demo-task-copy').textContent=text;
   for(const id of ['regAccountControls','secureOrganiserAccount','securePlayerAccount'])hide(id,true);
   if($('guidedStake')){const details=$('guidedStake').closest('details');if(!details.hidden)details.hidden=true;}
   if($('guidedAdvanced'))hide('guidedAdvanced',true);
  }
  function action(fn){try{fn();$('demo-task-help').textContent='Practice only: fictional data updated in this tab.';}catch(e){$('demo-task-help').textContent=e.message;}update();}
  $('demo-add-friends').onclick=()=>action(()=>IIG_DEMO.practice.addFriends());
  $('demo-other-scores').onclick=()=>action(()=>IIG_DEMO.practice.fillOtherScores());
  $('demo-become-organiser').onclick=()=>action(()=>IIG_DEMO.practice.asOrganiser());
  $('demo-view-scores').onclick=()=>window.show('scores');$('demo-view-results').onclick=()=>window.show('league');
  $('demo-tasks').onclick=()=>{if(confirm('Start again? This discards this tab’s fictional practice data.'))location.assign('/');};
  $('demo-feedback').onclick=()=>{
   if($('demo-feedback-sheet')){$('demo-feedback-sheet').hidden=false;return;}
   const sheet=document.createElement('section');sheet.id='demo-feedback-sheet';sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-label','Tester feedback');
   sheet.innerHTML='<div class="card"><h2>How did it feel?</h2><p>Nothing here is sent or saved online. Please take a screenshot of your answers and send it to Greg using your usual method. Do not include personal details.</p><label for="demo-rating">Could you do this without help?</label><select id="demo-rating"><option>Choose an answer</option><option>Yes, easily</option><option>Yes, with some hesitation</option><option>No, I got stuck</option></select><label for="demo-notes">Where did you hesitate? What did you expect to happen?</label><textarea id="demo-notes" rows="5" maxlength="2000" placeholder="For example: I could not find where to enter my score."></textarea><p>Useful screenshots: the confusing screen and your answers here. Refreshing discards these answers.</p><button id="demo-feedback-close" class="primary full">Back to practice</button></div>';
   document.body.append(sheet);$('demo-feedback-close').onclick=()=>{sheet.hidden=true;};$('demo-rating').focus();
  };
  // Keep the approved form blank for the independent first-visit task; examples stay above it.
  if(!friend)for(const id of ['regName','regGroupName','regSetupEmail'])if($(id))$(id).value='';
  if($('iig-demo-note'))$('iig-demo-note').textContent='Fictional demonstration. Use code 123456; nothing is sent.';
  const observer=new MutationObserver(update);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});update();
 });
})();
