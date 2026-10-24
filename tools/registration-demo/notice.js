/* Accessible demonstration notice only. No storage, requests or app configuration. */
(() => {
 'use strict';
 window.iigDemoNotice=Object.freeze({mount(panel){
  const banner=document.createElement('aside');banner.id='iig-demo-banner';banner.setAttribute('aria-label','Demonstration mode');
  banner.innerHTML='<button id="iig-demo-toggle" type="button" aria-haspopup="dialog" aria-controls="iig-demo-panel" aria-expanded="false"><span>DEMO MODE — Fictional data only</span><span aria-hidden="true">ⓘ</span></button>';
  panel.id='iig-demo-panel';panel.hidden=true;panel.setAttribute('aria-label','Demonstration explanation');
  document.body.append(banner,panel);const trigger=banner.querySelector('button');
  const size=()=>{const root=document.documentElement,viewport=window.visualViewport;root.style.setProperty('--iig-demo-top',banner.getBoundingClientRect().height+'px');root.style.setProperty('--iig-demo-viewport-height',(viewport?.height||innerHeight)+'px');};
  size();window.addEventListener('resize',size);window.visualViewport?.addEventListener('resize',size);
  const observer=new ResizeObserver(size);observer.observe(banner,{box:'border-box'});
  const close=()=>{if(panel.open)panel.close();panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});};
  const open=()=>{if(panel.open)return;panel.hidden=false;panel.showModal();trigger.setAttribute('aria-expanded','true');panel.scrollTop=0;panel.querySelector('button')?.focus({preventScroll:true});};
  panel.addEventListener('keydown',event=>{
   if(event.key!=='Tab')return;
   const controls=[...panel.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length);
   const first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  panel.addEventListener('cancel',event=>{event.preventDefault();close();});
  panel.addEventListener('close',()=>{panel.hidden=true;trigger.setAttribute('aria-expanded','false');});
  trigger.onclick=()=>panel.open?close():open();
  panel.querySelector('[data-demo-notice-close]')?.addEventListener('click',close);
  return Object.freeze({open,close});
 }});
})();
