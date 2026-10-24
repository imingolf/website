/* Source-derived welcome before the fictional tasks; no storage or backend calls. */
(() => {
 'use strict';
 document.addEventListener('DOMContentLoaded',()=>{
  const panel=document.createElement('dialog');
  panel.innerHTML='<div class="demo-notice-heading"><h2>Demonstration only</h2><button type="button" data-demo-notice-close>Close</button></div><p>This is a fictional practice version of I’m In Golf. No real accounts, emails, payments or WhatsApp messages are created or sent.</p><p>Use made-up details and an email ending @example.test. The practice email code is 123456. Your data stays in this tab and resets on reload. Real golf groups, scores and history are never loaded.</p><p>Once you have seen the welcome, tap Get started to choose an organiser or invited-player task.</p>';
  window.iigDemoNotice.mount(panel);
  document.getElementById('demo-welcome-start').onclick=()=>{
   document.getElementById('demo-first-launch').hidden=true;
   document.getElementById('demo-practice-tasks').hidden=false;
   document.getElementById('demo-tasks-title').focus({preventScroll:true});window.scrollTo(0,0);
  };
 });
})();
