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
