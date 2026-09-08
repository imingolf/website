window.TENS_IN_CONFIG = {
  supabaseUrl: "https://kzzzputsqxdntfqpprnz.supabase.co",
  supabaseKey: "sb_publishable_8_sOgkTbTiKyJqo0zjhHBQ_GqTMEbSz"
};

// Presentation-only wording polish for Admin payment setup.
(function(){
  const providerHelp={
    Monzo:'<b>What to do in Monzo</b><br>1. Open the Monzo app on your phone.<br>2. Look for <b>Request money</b> or your <b>Monzo.me</b> link.<br>3. Choose the option to <b>share or copy your payment link</b>.<br>4. Come back to I’m In Golf and paste the link below.<br><br><span class="muted"><b>Can’t see those exact words?</b> Look for Request money, Get paid, Share link or Monzo.me.</span>',
    Revolut:'<b>What to do in Revolut</b><br>1. Open the Revolut app on your phone.<br>2. Go to <b>Payments</b> and look for <b>Payment link</b> or <b>Request money</b>.<br>3. Create or open your personal payment link and <b>copy/share it</b>.<br>4. Come back to I’m In Golf and paste the link below.<br><br><span class="muted"><b>Can’t see those exact words?</b> Look for Request, Get paid, Payment link or Share link.</span>',
    PayPal:'<b>What to do in PayPal</b><br>1. Open PayPal on your phone.<br>2. Look for <b>Request</b>, <b>Get paid</b> or your <b>PayPal.Me</b> link.<br>3. Open your personal payment link and <b>copy/share it</b>.<br>4. Come back to I’m In Golf and paste the link below.<br><br><span class="muted"><b>Can’t see those exact words?</b> Look for Request, Get paid, PayPal.Me or Share link.</span>',
    Starling:'<b>What to do in Starling</b><br>1. Open the Starling app on your phone.<br>2. Look for <b>Request Money</b> or <b>Settle Up</b>.<br>3. Open your payment/request link and <b>copy/share it</b>.<br>4. Come back to I’m In Golf and paste the link below.<br><br><span class="muted"><b>Can’t see those exact words?</b> Look for Request Money, Get paid, Settle Up or Share link.</span>',
    Wise:'<b>What to do in Wise</b><br>1. Open the Wise app on your phone.<br>2. Look for <b>Request</b>, <b>Get paid</b> or your <b>Wisetag</b>.<br>3. Create/open your payment link and <b>copy/share it</b>.<br>4. Come back to I’m In Golf and paste the link below.<br><br><span class="muted"><b>Can’t see those exact words?</b> Look for Request, Get paid, Wisetag or Share link.</span>',
    'Other secure link':'<b>What to do in your payment app</b><br>1. Open your banking or payment app on your phone.<br>2. Look for <b>Request money</b>, <b>Get paid</b> or <b>Payment link</b>.<br>3. Create/open your personal payment link and <b>copy/share it</b>.<br>4. Come back to I’m In Golf and paste the secure link below.<br><br><span class="muted">Your link should normally start with <b>https://</b>. Never paste bank account numbers or passwords into I’m In Golf.</span>'
  };

  function applyPaymentWording(){
    document.querySelectorAll('.card h2').forEach(function(h2){
      if(h2.textContent.trim() === '💷 Player payments'){
        var card=h2.closest('.card'); if(!card)return;
        h2.textContent='💷 Collect entry fees';
        var notice=card.querySelector('.notice');
        if(notice) notice.innerHTML='<b>How players pay</b><br>Add a payment link (for example Monzo, Revolut or PayPal). Players tap the link in the app and pay you directly for the round.<br><br><b>I’m In Golf does not receive or hold the money.</b>';
        card.querySelectorAll('button').forEach(function(btn){
          if(btn.textContent.indexOf('Set Up Player Payments')!==-1)btn.textContent='➕ Set Up Payment Link';
          if(btn.textContent.indexOf('Change Payment Method')!==-1)btn.textContent='✏️ Change Payment Link';
        });
      }
    });

    // Step 2 of payment setup: replace the terse provider menu path with plain-English instructions.
    document.querySelectorAll('.card').forEach(function(card){
      var heading=card.querySelector('h2');
      if(!heading)return;
      var text=heading.textContent.trim();
      var provider=Object.keys(providerHelp).find(function(name){return text.indexOf('Add your '+name+' link')!==-1;});
      if(!provider)return;
      var notices=card.querySelectorAll('.notice');
      notices.forEach(function(n){
        var t=n.textContent||'';
        if(t.indexOf('Where to find it')!==-1 || t.indexOf('What to do in ')!==-1){
          n.innerHTML=providerHelp[provider];
        }
      });
    });
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyPaymentWording); else applyPaymentWording();
  new MutationObserver(applyPaymentWording).observe(document.documentElement,{childList:true,subtree:true});
})();
