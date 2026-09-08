window.TENS_IN_CONFIG = {
  supabaseUrl: "https://kzzzputsqxdntfqpprnz.supabase.co",
  supabaseKey: atob("c2JfcHVibGlzaGFibGVfOF9zT2drVGJUaUt5SnFvMHpqaEhCUV9HcVRNRWJTeg==")
};

(function(){
  function applyPaymentWording(){
    document.querySelectorAll('.card h2').forEach(function(h2){
      if(h2.textContent.trim()==='💷 Player payments'){
        var card=h2.closest('.card'); if(!card)return;
        h2.textContent='💷 Collect entry fees';
        var notice=card.querySelector('.notice');
        if(notice)notice.innerHTML='<b>How players pay</b><br>Add a payment link (for example Monzo, Revolut or PayPal). Players tap the link in the app and pay you directly for the round.<br><br><b>I’m In Golf does not receive or hold the money.</b>';
        card.querySelectorAll('button').forEach(function(btn){
          if(btn.textContent.indexOf('Set Up Player Payments')!==-1)btn.textContent='➕ Set Up Payment Link';
          if(btn.textContent.indexOf('Change Payment Method')!==-1)btn.textContent='✏️ Change Payment Link';
        });
      }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyPaymentWording); else applyPaymentWording();
})();

setTimeout(function(){
  try{
    if(typeof PAYMENT_PROVIDERS==='undefined')return;
    PAYMENT_PROVIDERS.monzo.hint="1. Open Monzo. 2. Look for Request money or your Monzo.me link. 3. Copy or share your payment link. 4. Return to I'm In Golf and paste it below. Can't see those exact words? Look for Request money, Get paid, Share link or Monzo.me.";
    PAYMENT_PROVIDERS.monzo.steps=["Open Monzo.","Look for Request money or your Monzo.me link.","Copy or share your personal payment link.","Return to I'm In Golf and paste the link."];
    PAYMENT_PROVIDERS.revolut.hint="1. Open Revolut. 2. Go to Payments and look for Request money or Payment link. 3. Create or open your personal payment link and copy or share it. 4. Return to I'm In Golf and paste it below. Can't see those exact words? Look for Request, Get paid, Payment link or Share link.";
    PAYMENT_PROVIDERS.revolut.steps=["Open Revolut and go to Payments.","Look for Request money or Payment link.","Create or open your personal payment link and copy or share it.","Return to I'm In Golf and paste the link."];
    PAYMENT_PROVIDERS.paypal.hint="1. Open PayPal. 2. Look for Request, Get paid or PayPal.Me. 3. Open your personal payment link and copy or share it. 4. Return to I'm In Golf and paste it below. Can't see those exact words? Look for Request, Get paid, PayPal.Me or Share link.";
    PAYMENT_PROVIDERS.paypal.steps=["Open PayPal.","Look for Request, Get paid or PayPal.Me.","Open your personal payment link and copy or share it.","Return to I'm In Golf and paste the link."];
    PAYMENT_PROVIDERS.starling.hint="1. Open Starling. 2. Look for Request Money or Settle Up. 3. Open your payment/request link and copy or share it. 4. Return to I'm In Golf and paste it below. Can't see those exact words? Look for Request Money, Get paid, Settle Up or Share link.";
    PAYMENT_PROVIDERS.starling.steps=["Open Starling.","Look for Request Money or Settle Up.","Open your payment/request link and copy or share it.","Return to I'm In Golf and paste the link."];
    PAYMENT_PROVIDERS.wise.hint="1. Open Wise. 2. Look for Request, Get paid or Wisetag. 3. Create or open your payment link and copy or share it. 4. Return to I'm In Golf and paste it below. Can't see those exact words? Look for Request, Get paid, Wisetag or Share link.";
    PAYMENT_PROVIDERS.wise.steps=["Open Wise.","Look for Request, Get paid or Wisetag.","Create or open your payment link and copy or share it.","Return to I'm In Golf and paste the link."];
    PAYMENT_PROVIDERS.other.label="secure payment";
    PAYMENT_PROVIDERS.other.hint="1. Open your banking or payment app. 2. Look for Request money, Get paid or Payment link. 3. Create or open your personal payment link and copy or share it. 4. Return to I'm In Golf and paste the secure link below. Never paste a password or PIN into I'm In Golf.";
    PAYMENT_PROVIDERS.other.steps=["Open your banking or payment app.","Look for Request money, Get paid or Payment link.","Create or open your personal payment link and copy or share it.","Return to I'm In Golf and paste the secure link. Never enter a password or PIN."];
  }catch(e){}
},0);

(function(){
  function addSmallGroupRemoveButtons(){
    try{
      if(typeof state==='undefined'||typeof isAdmin==='undefined'||!isAdmin)return;
      if(!Array.isArray(state.players)||state.players.length>2)return;
      if(typeof removePlayer!=='function')return;
      document.querySelectorAll('#screen .player').forEach(function(row,index){
        var editButton=Array.from(row.querySelectorAll('button')).find(function(btn){return btn.textContent.trim()==='Edit';});
        if(!editButton)return;
        var holder=editButton.parentElement;
        if(!holder||holder.querySelector('[data-iig-remove-player]'))return;
        var btn=document.createElement('button');
        btn.className='red small'; btn.type='button'; btn.setAttribute('data-iig-remove-player','1'); btn.textContent='Remove'; btn.style.marginLeft='6px';
        btn.addEventListener('click',function(){removePlayer(index);});
        holder.appendChild(btn);
      });
    }catch(e){}
  }
  function start(){
    addSmallGroupRemoveButtons();
    var screen=document.getElementById('screen'); if(!screen)return;
    new MutationObserver(addSmallGroupRemoveButtons).observe(screen,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function installRoundSetupRefreshGuard(attempt){
  setTimeout(function(){
    try{
      if(typeof refresh!=='function'){if(attempt<20)installRoundSetupRefreshGuard(attempt+1);return;}
      if(refresh.__iigRoundSetupGuard)return;
      var originalRefresh=refresh;
      var guarded=async function(){
        var screen=document.getElementById('screen');
        if(screen&&(screen.querySelector('#firstRoundStake')||screen.querySelector('#normalSetupStake')||screen.querySelector('#normalSetupStart')))return;
        return originalRefresh.apply(this,arguments);
      };
      guarded.__iigRoundSetupGuard=true;
      refresh=guarded;
    }catch(e){}
  },attempt?100:0);
})(0);

(function(){
  function updateAdminHeader(){
    try{
      var header=document.querySelector('.app > header')||document.querySelector('header');
      var screen=document.getElementById('screen');
      if(screen){var old=screen.querySelector('[data-iig-admin-mode-banner]');if(old)old.remove();}
      if(!header)return;
      var badge=header.querySelector('[data-iig-admin-header]');
      if(typeof isAdmin==='undefined'||!isAdmin){if(badge)badge.remove();return;}
      if(!badge){
        badge=document.createElement('div');
        badge.setAttribute('data-iig-admin-header','1');
        badge.innerHTML='<b>⚙️ Admin mode</b><span>You are managing this golf group.</span>';
        badge.style.cssText='margin-top:12px;background:#e3f5e8;color:#145f34;border:1px solid #c6ead1;border-radius:12px;padding:9px 11px;display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap;font-size:13px;line-height:1.25;';
        var b=badge.querySelector('b'); if(b)b.style.fontSize='14px';
        var s=badge.querySelector('span'); if(s)s.style.opacity='.95';
        header.appendChild(badge);
      }
    }catch(e){}
  }
  function start(){
    updateAdminHeader();
    var screen=document.getElementById('screen');
    if(screen)new MutationObserver(updateAdminHeader).observe(screen,{childList:true,subtree:false});
    setInterval(updateAdminHeader,1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function(){
  function applyAdminGreenHighlights(){
    try{
      var screen=document.getElementById('screen'); if(!screen)return;
      var adminOn=(typeof isAdmin!=='undefined'&&isAdmin);
      screen.querySelectorAll('[data-iig-admin-green]').forEach(function(el){
        if(!adminOn){el.style.background='';el.style.color='';el.style.borderColor='';el.style.fontWeight='';el.removeAttribute('data-iig-admin-green');}
      });
      if(!adminOn)return;
      var wanted=['OPEN','MONEY GAME','POINTS GAME','NET','STABLEFORD','ENTRY','PLAYERS IN','PAID'];
      screen.querySelectorAll('button,.pill,.badge,.chip,span').forEach(function(el){
        var text=(el.textContent||'').trim().toUpperCase();
        if(!text||text.length>32)return;
        if(wanted.some(function(word){return text.indexOf(word)!==-1;})){
          el.setAttribute('data-iig-admin-green','1');
          el.style.background='#e3f5e8';
          el.style.color='#147a3d';
          el.style.borderColor='#c6ead1';
          el.style.fontWeight='700';
        }
      });
    }catch(e){}
  }
  function start(){
    applyAdminGreenHighlights();
    var screen=document.getElementById('screen'); if(!screen)return;
    new MutationObserver(applyAdminGreenHighlights).observe(screen,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function(){
  var labels=['ROUND','PAY','SCORES','LEAGUE','PLAYERS'];
  function paintAdminNav(){
    try{
      var adminOn=(typeof isAdmin!=='undefined'&&isAdmin);
      document.querySelectorAll('[data-iig-admin-nav]').forEach(function(el){
        if(!adminOn){el.style.background='';el.style.color='';el.style.borderRadius='';el.style.padding='';el.removeAttribute('data-iig-admin-nav');}
      });
      if(!adminOn)return;
      var all=Array.from(document.querySelectorAll('nav *, .nav *, .bottom-nav *, .tabs *, footer *'));
      all.forEach(function(el){
        var text=(el.textContent||'').trim().toUpperCase();
        if(labels.indexOf(text)===-1)return;
        var target=el;
        if(el.parentElement){
          var ptext=(el.parentElement.textContent||'').trim().toUpperCase();
          if(ptext===text)target=el.parentElement;
        }
        target.setAttribute('data-iig-admin-nav','1');
        target.style.background='#e3f5e8';
        target.style.color='#147a3d';
        target.style.borderRadius='12px';
        target.style.padding='7px 5px';
      });
    }catch(e){}
  }
  function start(){
    paintAdminNav();
    new MutationObserver(paintAdminNav).observe(document.body,{childList:true,subtree:true});
    setInterval(paintAdminNav,1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function(){
  function installStyle(){
    if(document.getElementById('iig-admin-nav-style'))return;
    var style=document.createElement('style');
    style.id='iig-admin-nav-style';
    style.textContent='nav.iig-admin-nav-bar{background:#e3f5e8!important;border-top:1px solid #c6ead1!important;}nav.iig-admin-nav-bar button:not(.hidden){background:transparent!important;color:#147a3d!important;border-radius:0!important;padding:11px 2px!important;font-weight:700!important;}nav.iig-admin-nav-bar button.active{color:#147a3d!important;font-weight:800!important;}';
    document.head.appendChild(style);
  }
  function syncAdminNavBar(){
    try{
      installStyle();
      var nav=document.querySelector('.app > nav')||document.querySelector('nav');
      if(!nav)return;
      var adminOn=(typeof isAdmin!=='undefined'&&isAdmin);
      nav.classList.toggle('iig-admin-nav-bar',adminOn);
    }catch(e){}
  }
  function start(){
    syncAdminNavBar();
    new MutationObserver(syncAdminNavBar).observe(document.body,{childList:true,subtree:true});
    setInterval(syncAdminNavBar,250);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function(){
  function getGroupName(){
    try{
      if(typeof state!=='undefined'&&state){
        var fromState=state.groupName||state.group_name||state.name;
        if(fromState&&String(fromState).trim())return String(fromState).trim();
      }
      var headerGroup=document.getElementById('headerGroup');
      if(headerGroup&&headerGroup.textContent.trim())return headerGroup.textContent.trim();
    }catch(e){}
    return 'Golf Group';
  }
  function contactAdminSupport(){
    var groupName=getGroupName();
    var subject="I'm In Golf - Admin Support - "+groupName;
    var body="Hi I'm In Golf,\n\nI need some help with my golf group.\n\nGroup: "+groupName+"\n\nPlease describe the issue below:\n\n";
    window.location.href='mailto:hello@imingolf.co.uk?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body);
  }
  window.iigContactAdminSupport=contactAdminSupport;
  function addAdminSupport(){
    try{
      var screen=document.getElementById('screen');
      if(!screen)return;
      var adminOn=(typeof isAdmin!=='undefined'&&isAdmin);
      var helpHeading=Array.from(screen.querySelectorAll('h2')).find(function(h2){return (h2.textContent||'').indexOf('Admin Help')!==-1;});
      if(!adminOn||!helpHeading)return;
      if(screen.querySelector('[data-iig-contact-support]'))return;
      var card=document.createElement('div');
      card.className='card';
      card.setAttribute('data-iig-contact-support','1');
      card.innerHTML='<div style="text-align:center;"><div style="font-size:26px;">✉️</div><h2 style="margin:4px 0 6px;">Still need help?</h2><div class="muted">Contact the I\'m In Golf support team.</div></div><button class="primary full" type="button" data-iig-contact-support-button>✉️ Contact Support</button>';
      card.querySelector('[data-iig-contact-support-button]').addEventListener('click',contactAdminSupport);
      var cards=screen.querySelectorAll(':scope > .card');
      var last=cards.length?cards[cards.length-1]:null;
      if(last)screen.insertBefore(card,last); else screen.appendChild(card);
    }catch(e){}
  }
  function start(){
    addAdminSupport();
    var screen=document.getElementById('screen');
    if(screen)new MutationObserver(addAdminSupport).observe(screen,{childList:true,subtree:false});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function installFinishRoundConfirmation(attempt){
  setTimeout(function(){
    try{
      if(typeof finishRound!=='function'){if(attempt<20)installFinishRoundConfirmation(attempt+1);return;}
      if(finishRound.__iigFinishRoundConfirm)return;
      var originalFinishRound=finishRound;
      var wrappedFinishRound=async function(){
        var ok=await appConfirm('Finish Round','Ready to finish this round?\n\nThis will finalise the result and save it to League → Previous rounds. Check all scores are correct before continuing.','Finish Round');
        if(!ok)return;
        return originalFinishRound.apply(this,arguments);
      };
      wrappedFinishRound.__iigFinishRoundConfirm=true;
      finishRound=wrappedFinishRound;
    }catch(e){}
  },attempt?100:0);
})(0);

(function(){
  var waitingForScoreSave=false;
  var shownForThisSubmit=false;
  function showScoreToast(){
    if(shownForThisSubmit)return;
    shownForThisSubmit=true;
    waitingForScoreSave=false;
    var old=document.querySelector('[data-iig-score-toast]');
    if(old)old.remove();
    var toast=document.createElement('div');
    toast.className='app-toast';
    toast.setAttribute('data-iig-score-toast','1');
    toast.innerHTML='<b>✅ Score’s in!</b><span>Good luck — enjoy the rest of your round. ⛳</span>';
    document.body.appendChild(toast);
    requestAnimationFrame(function(){toast.classList.add('show');});
    setTimeout(function(){toast.classList.remove('show');setTimeout(function(){if(toast.parentNode)toast.remove();},220);},2800);
  }
  document.addEventListener('click',function(e){
    var btn=e.target&&e.target.closest?e.target.closest('button'):null;
    if(!btn)return;
    var text=(btn.textContent||'').trim().toLowerCase();
    if(text==='submit score'){waitingForScoreSave=true;shownForThisSubmit=false;}
  },true);
  function checkForSavedScore(){
    if(!waitingForScoreSave||shownForThisSubmit)return;
    var screen=document.getElementById('screen');
    if(!screen)return;
    var text=(screen.textContent||'').toLowerCase();
    if(text.indexOf('score submitted')!==-1||text.indexOf('submitted')!==-1)showScoreToast();
  }
  function start(){
    var screen=document.getElementById('screen');
    if(!screen)return;
    new MutationObserver(checkForSavedScore).observe(screen,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();

(function installBrandedAdminDialogs(attempt){
  setTimeout(function(){
    try{
      if(typeof appPrompt!=='function'||typeof appConfirm!=='function'||typeof state==='undefined'){
        if(attempt<20)installBrandedAdminDialogs(attempt+1);
        return;
      }
      changeGroupName=async function(){
        if(!isAdmin)return;
        var current=String(state.groupName||'').trim();
        var entered=await appPrompt('Change Group Name','What would you like this group to be called?',current||'My Golf Group',{okLabel:'Save Group Name'});
        if(entered===null)return;
        var clean=String(entered).trim();
        if(!clean){showAppToast('Group name needed','Please enter a group name.',3000);return;}
        var previous=state.groupName;
        state.groupName=clean;
        var ok=await save();
        if(!ok){state.groupName=previous;showAppToast('Not saved','The group name could not be saved. Please try again.',3200);return;}
        render();
        showAppToast('✅ Group name changed',clean,3000);
      };
      editPlayer=async function(i){
        var p=state.players[i];
        if(!p)return;
        var name=await appPrompt('Edit Player','Player name',p.name,{okLabel:'Next'});
        if(name===null)return;
        name=String(name).trim();
        if(!name){showAppToast('Name needed','Please enter the player’s name.',3000);return;}
        var h=await appPrompt('Edit Player','Golf handicap',p.handicap,{type:'number',inputmode:'decimal',okLabel:'Save Player'});
        if(h===null)return;
        var handicap=Number(h);
        if(!Number.isFinite(handicap)||handicap < -10||handicap > 60){showAppToast('Invalid handicap','Please enter a handicap between -10 and 60.',3200);return;}
        p.name=name;
        p.handicap=handicap;
        render();
        await save();
        showAppToast('✅ Player updated',name,2600);
      };
      adminAddPlayer=async function(){
        if(!isAdmin||!demoCanEdit())return;
        var first=await appPrompt('Add Player','First name','',{okLabel:'Next'});
        if(first===null)return;
        var surname=await appPrompt('Add Player','Surname','',{okLabel:'Next'});
        if(surname===null)return;
        first=String(first).trim(); surname=String(surname).trim();
        if(!first||!surname){showAppToast('Name needed','Please enter the player’s first name and surname.',3200);return;}
        var cleanName=(first+' '+surname).trim();
        if(state.players.some(function(p){return p.name.trim().toLowerCase()===cleanName.toLowerCase();})){showAppToast('Already in the group',cleanName+' is already listed.',3200);return;}
        var h=await appPrompt('Add Player','Golf handicap','18',{type:'number',inputmode:'decimal',okLabel:'Add Player'});
        if(h===null)return;
        var handicap=Number(h);
        if(!Number.isFinite(handicap)||handicap < -10||handicap > 60){showAppToast('Invalid handicap','Please enter a handicap between -10 and 60.',3200);return;}
        state.players.push({id:Date.now().toString(36),name:cleanName,handicap:handicap,competition:null,paid:false,stableford:null,netScore:null,noReturn:false,scoreSubmitted:false,wins:0,leaguePoints:0,netWinnings:0});
        await save();
        render();
        showAppToast('✅ Player added',cleanName+' is now in the group.',3000);
      };
      changeCurrentRoundCompetition=async function(){
        if(!isAdmin)return;
        if(!roundOpenNow()){showAppToast('No open round','There is no open round to change.',3000);return;}
        if(roundLocked()){showAppToast('Competition locked','The competition cannot be changed after scoring has started.',3200);return;}
        var current=(state.pointsCompetition||'stableford')==='net'?'net':'stableford';
        var next=current==='stableford'?'net':'stableford';
        var currentLabel=current==='stableford'?'Stableford':'Net';
        var nextLabel=next==='stableford'?'Stableford':'Net';
        var ok=await appConfirm('Change Competition','Change this round from '+currentLabel+' to '+nextLabel+'?\n\nPlayers, payments, course, date and stake will stay unchanged.','Change to '+nextLabel);
        if(!ok)return;
        state.pointsCompetition=next;
        state.players.forEach(function(p){if(p.stableford==null&&p.netScore==null&&p.noReturn!==true)p.competition=next;});
        await save();
        showAppToast('✅ Competition changed',nextLabel+' is now selected.',3000);
        settingsPage();
      };
    }catch(e){}
  },attempt?100:0);
})(0);

// Complete the browser-dialog cleanup for Owner, payment, prize and destructive admin flows.
(function installRemainingBrandedDialogs(attempt){
  setTimeout(function(){
    try{
      if(typeof appPrompt!=='function'||typeof appConfirm!=='function'||typeof showAppToast!=='function'){
        if(attempt<20)installRemainingBrandedDialogs(attempt+1);
        return;
      }

      if(typeof ownerLogin==='function')ownerLogin=async function(){
        if(!isAdmin){showAppToast('Admin access required','Open Admin Mode first.',3000);return;}
        var entered=await appPrompt('Owner Access',"Enter your private I'm In Golf owner creation code",'',{type:'password',okLabel:'Open Owner Controls'});
        if(entered===null)return;
        var clean=String(entered).trim();
        if(!clean){showAppToast('Code required','Enter the private owner creation code.',3000);return;}
        ownerCreationCode=clean;isOwner=true;render();
      };

      if(typeof ownerResetAdminPin==='function')ownerResetAdminPin=async function(){
        if(!db||!isAdmin||!isOwner||!ownerCreationCode){showAppToast('Owner access required','Open Owner Controls first.',3000);return;}
        var groupPin=String(ownerEditGroupPin||'');
        if(!groupPin){showAppToast('Group not found','The group could not be identified.',3000);return;}
        var first=await appPrompt('Reset Admin PIN','Choose a new 4-digit Admin PIN for group '+groupPin,'',{type:'password',inputmode:'numeric',okLabel:'Next'});
        if(first===null)return;
        var clean=String(first).trim();
        if(!validAdminPin(clean)){showAppToast('4 digits needed','Please choose exactly 4 numbers.',3000);return;}
        var second=await appPrompt('Confirm Admin PIN','Enter the new 4-digit PIN again','',{type:'password',inputmode:'numeric',okLabel:'Continue'});
        if(second===null)return;
        if(String(second).trim()!==clean){showAppToast('PINs do not match','Please try again.',3000);return;}
        var ok=await appConfirm('Reset Admin PIN','Reset the Admin PIN for group '+groupPin+'?','Reset Admin PIN',true);
        if(!ok)return;
        var result=await db.rpc('owner_reset_admin_pin',{p_creation_code:ownerCreationCode,p_group_pin:groupPin,p_new_admin_pin:clean});
        if(result.error||result.data!==true){showAppToast('PIN not reset',result.error&&result.error.message?result.error.message:'Please try again.',3600);return;}
        if(groupPin===String(pin)){state.adminPin=clean;state.adminSetupToken='';}
        showAppToast('✅ Admin PIN reset','Group '+groupPin+' is ready.',3000);
      };

      if(typeof copyAdminInvite==='function')copyAdminInvite=async function(){
        if(!lastAdminInvite){showAppToast('No invite yet','Create a new group first.',3000);return;}
        try{await navigator.clipboard.writeText(lastAdminInvite);showAppToast('✅ Admin invite copied','Paste it into WhatsApp or your message app.',3000);}
        catch(e){await appPrompt('Copy Admin Invite','Copy the message below.',lastAdminInvite,{okLabel:'Done'});}
      };

      if(typeof createNewGolfGroup==='function')createNewGolfGroup=async function(){
        if(!isAdmin||!isOwner||!ownerCreationCode){showAppToast('Owner access required','Open Owner Controls first.',3000);return;}
        if(!db){showAppToast('No database connection','Please try again when the app is online.',3200);return;}
        var groupName=await appPrompt('Create New Golf Group','What is the new group called?','',{okLabel:'Create Group'});
        if(groupName===null)return;
        var cleanGroupName=String(groupName).trim();
        if(!cleanGroupName){showAppToast('Group name needed','Please enter a group name.',3000);return;}
        var newState={groupName:cleanGroupName,course:'',date:'',stake:0,gameType:'money',roundOpen:false,pointsCompetition:'stableford',pointsValue:10,adminPin:'',adminSetupToken:'',players:[],history:[]};
        var created=await db.rpc('create_golf_group',{p_group_name:cleanGroupName,p_state:newState,p_creation_code:ownerCreationCode});
        if(created.error){isOwner=false;ownerCreationCode='';render();showAppToast('Owner access not accepted','Check your private owner creation code and try again.',3800);return;}
        var newPin=String(created.data);
        var setupToken=crypto.randomUUID?crypto.randomUUID():(Date.now().toString(36)+Math.random().toString(36).slice(2));
        var createdState=Object.assign({},newState,{adminSetupToken:setupToken});
        var setup=await db.rpc('save_group_state',{p_pin:newPin,p_state:createdState});
        if(setup.error){showAppToast('Group created','Admin setup could not be prepared. Please try again before sending the invite.',4200);return;}
        lastAdminInvite='⛳ I\'m In Golf\n\nYou\'ve been invited to manage '+cleanGroupName+'.\n\nGroup PIN: '+newPin+'\n\nTap below to set up your 4-digit Admin PIN:\nhttps://imingolf.co.uk/app/?pin='+encodeURIComponent(newPin)+'&adminsetup='+encodeURIComponent(setupToken)+'\n\n🔒 Keep this link private.';
        page='admininvite';adminInvitePage();window.scrollTo(0,0);
      };

      if(typeof cancelCurrentRound==='function')cancelCurrentRound=async function(){
        if(!isAdmin){showAppToast('Admin only','Only the Group Admin can cancel the current round.',3200);return;}
        if(state.trip&&state.trip.active){showAppToast('Trip active','Use Cancel Current Trip instead.',3000);return;}
        var hasRound=Boolean(String(state.course||'').trim())||Boolean(state.date)||state.players.some(function(p){return p.paid||p.scoreSubmitted||p.stableford!=null||p.netScore!=null||p.noReturn===true||Boolean(p.competition);});
        if(!hasRound){showAppToast('No current round','There is nothing to cancel.',3000);return;}
        var ok=await appConfirm('Cancel Current Round','This clears only the current round setup, payments, competition choices and scores.\n\nPlayers, league standings and previous-round history will NOT be deleted.','Cancel Round',true);
        if(!ok)return;
        state.course='';state.date='';state.gameType='money';state.pointsCompetition='stableford';state.pointsValue=10;state.roundOpen=false;
        state.players.forEach(function(p){p.paid=false;p.competition=null;p.stableford=null;p.netScore=null;p.noReturn=false;p.scoreSubmitted=false;});
        scoreDraftActive=false;
        if(!await save()){showAppToast('Not cancelled','The current round could not be cancelled. Please try again.',3400);return;}
        showAppToast('✅ Round cancelled','League and previous-round history were kept.',3200);show('round');
      };

      if(typeof changePaymentLink==='function'){
        var originalChangePaymentLink=changePaymentLink;
        changePaymentLink=async function(){
          var before=String(state.paymentLink||'');
          await originalChangePaymentLink.apply(this,arguments);
          if(before!==String(state.paymentLink||''))showAppToast('✅ Payment method updated','Players will pay you directly.',3000);
        };
      }

      if(typeof markWinnerPaid==='function')markWinnerPaid=async function(historyIndex,payoutId,allowAwaiting){
        if(!isAdmin||!demoCanEdit())return;
        var record=(state.history||[])[Number(historyIndex)];if(!record)return;
        if(!Array.isArray(record.payouts))record.payouts=createWinnerPayouts(record);
        var payout=record.payouts.find(function(p){return p.id===payoutId;});if(!payout)return;
        var allowed=['ready','bank_details_needed'];if(allowAwaiting)allowed.push('awaiting_details');if(allowed.indexOf(payout.status)===-1)return;
        var ok=await appConfirm('Confirm Prize Payment','Confirm that £'+moneyText(payout.amount)+' has been sent to '+payout.winnerName+'?','Mark as Paid');
        if(!ok)return;
        payout.status='paid';payout.paidAt=new Date().toISOString();
        if(await save()){showRoundHistory(historyIndex);showAppToast('✅ Prize marked paid','£'+moneyText(payout.amount)+' sent to '+payout.winnerName+'.',3000);}
      };

      if(typeof deletePastTrip==='function')deletePastTrip=async function(){
        var pastTrips=state.trip&&state.trip.pastTrips?state.trip.pastTrips:[];
        if(!pastTrips.length){showAppToast('No past trips','There are no past trips to delete.',3000);return;}
        var names=pastTrips.map(function(t,i){return (i+1)+'. '+(t.name||'Unnamed Trip');}).join('\n');
        var answer=await appPrompt('Delete Past Trip','Which trip do you want to delete?\n\n'+names+'\n\nEnter the trip number.','',{type:'number',inputmode:'numeric',okLabel:'Continue'});
        if(answer===null)return;
        var index=Number(answer)-1;
        if(index<0||index>=pastTrips.length){showAppToast('Choose a listed trip','Enter one of the trip numbers shown.',3000);return;}
        var tripName=pastTrips[index].name||'Trip';
        var ok=await appConfirm('Delete '+tripName,'This removes only this past Trip.\n\nNormal leagues, players and the current round will not be changed.','Delete Trip',true);
        if(!ok)return;
        pastTrips.splice(index,1);state.trip.pastTrips=pastTrips;await save();render();showAppToast('Trip deleted',tripName+' was removed.',3000);
      };
    }catch(e){}
  },attempt?120:0);
})(0);

// Make a wrong Group PIN obvious, friendly and immediately retryable.
(function(){
  function improvePinMessage(){
    var msg=document.getElementById('connectMsg');
    if(!msg)return;
    var text=(msg.textContent||'').trim().toLowerCase();
    if(text.indexOf('pin not recognised')===-1 && text.indexOf('pin not recognized')===-1)return;
    msg.innerHTML='<b>That Group PIN doesn’t look right.</b><br>Please check the 4 digits and try again.';
    msg.style.cssText='margin-top:12px;padding:12px 14px;border-radius:12px;background:#fff1c7;color:#7a5700;font-size:14px;line-height:1.4;text-align:center;border:1px solid #f1d889;';
    var input=document.getElementById('pinInput');
    if(input){input.select();input.focus();}
  }
  function start(){
    var msg=document.getElementById('connectMsg');
    if(!msg)return;
    improvePinMessage();
    new MutationObserver(improvePinMessage).observe(msg,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();
