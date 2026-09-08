window.TENS_IN_CONFIG = {
  supabaseUrl: "https://kzzzputsqxdntfqpprnz.supabase.co",
  supabaseKey: "sb_publishable_8_sOgkTbTiKyJqo0zjhHBQ_GqTMEbSz"
};

// Presentation-only wording polish for Admin payment setup.
(function(){
  function applyPaymentWording(){
    document.querySelectorAll('.card h2').forEach(function(h2){
      if(h2.textContent.trim() === '💷 Player payments'){
        var card = h2.closest('.card');
        if(!card) return;
        h2.textContent = '💷 Collect entry fees';
        var notice = card.querySelector('.notice');
        if(notice){
          notice.innerHTML = '<b>How players pay</b><br>Add a payment link (for example Monzo, Revolut or PayPal). Players tap the link in the app and pay you directly for the round.<br><br><b>I’m In Golf does not receive or hold the money.</b>';
        }
        card.querySelectorAll('button').forEach(function(btn){
          if(btn.textContent.indexOf('Set Up Player Payments') !== -1) btn.textContent = '➕ Set Up Payment Link';
          if(btn.textContent.indexOf('Change Payment Method') !== -1) btn.textContent = '✏️ Change Payment Link';
        });
      }
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyPaymentWording);
  else applyPaymentWording();
  new MutationObserver(applyPaymentWording).observe(document.documentElement,{childList:true,subtree:true});
})();
