window.TENS_IN_CONFIG = {
  supabaseUrl: "https://kzzzputsqxdntfqpprnz.supabase.co",
  supabaseKey: atob("c2JfcHVibGlzaGFibGVfOF9zT2drVGJUaUt5SnFvMHpqaEhCUV9HcVRNRWJTeg==")
};

// Presentation-only wording polish for Admin payment setup.
// Important: do not observe/rewrite the live payment wizard; its own render functions attach button handlers.
(function(){
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
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',applyPaymentWording);
  else applyPaymentWording();
})();

// Provider-specific guidance for the existing payment wizard.
// This changes only the wording data after the main app has loaded; it does not rewrite the wizard DOM or button handlers.
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
  }catch(e){
    // Leave the original built-in guidance untouched if the app structure ever changes.
  }
},0);
