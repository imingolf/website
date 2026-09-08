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

// Put the Admin indicator inside the green app header to save vertical space.
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

// Admin-only visual treatment: compact controls/badges use the soft green background.
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

// Admin-only bottom navigation highlight: Round, Pay, Scores, League and Players.
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

// Approved Admin Mode bottom bar: one continuous pale green bar with all five labels green.
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

// Admin Help: always give the organiser a simple route to contact support.
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
      var helpHeading=Array.from(screen.querySelectorAll('h2')).find(function(h2){
        return (h2.textContent||'').indexOf('Admin Help')!==-1;
      });
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

// Safety check before an admin finalises a round.
(function installFinishRoundConfirmation(attempt){
  setTimeout(function(){
    try{
      if(typeof finishRound!=='function'){
        if(attempt<20)installFinishRoundConfirmation(attempt+1);
        return;
      }
      if(finishRound.__iigFinishRoundConfirm)return;
      var originalFinishRound=finishRound;
      var wrappedFinishRound=async function(){
        var ok=await appConfirm(
          'Finish Round',
          'Ready to finish this round?\n\nThis will finalise the result and save it to League → Previous rounds. Check all scores are correct before continuing.',
          'Finish Round'
        );
        if(!ok)return;
        return originalFinishRound.apply(this,arguments);
      };
      wrappedFinishRound.__iigFinishRoundConfirm=true;
      finishRound=wrappedFinishRound;
    }catch(e){}
  },attempt?100:0);
})(0);

// Friendly player feedback after a score is successfully submitted.
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
    setTimeout(function(){
      toast.classList.remove('show');
      setTimeout(function(){if(toast.parentNode)toast.remove();},220);
    },2800);
  }

  document.addEventListener('click',function(e){
    var btn=e.target&&e.target.closest?e.target.closest('button'):null;
    if(!btn)return;
    var text=(btn.textContent||'').trim().toLowerCase();
    if(text==='submit score'){
      waitingForScoreSave=true;
      shownForThisSubmit=false;
    }
  },true);

  function checkForSavedScore(){
    if(!waitingForScoreSave||shownForThisSubmit)return;
    var screen=document.getElementById('screen');
    if(!screen)return;
    var text=(screen.textContent||'').toLowerCase();
    if(text.indexOf('score submitted')!==-1||text.indexOf('submitted')!==-1){
      showScoreToast();
    }
  }

  function start(){
    var screen=document.getElementById('screen');
    if(!screen)return;
    new MutationObserver(checkForSavedScore).observe(screen,{childList:true,subtree:true,characterData:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();