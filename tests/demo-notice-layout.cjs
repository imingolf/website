// Offline iPhone-sized layout checks. HTTPS responses are local files; no live site contacted.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'iig-notice-layout-')),out=path.join(tmp,'site'),origin='https://fictional-notice.example.test';
 const built=spawnSync('python3',['tools/registration-demo/build_static.py','--origin',origin,'--out',out],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER||'/usr/bin/chromium',headless:true});
 try{
  for(const viewport of [{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:844,height:390}]){
   const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,reducedMotion:'reduce',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}),page=await context.newPage(),external=[],errors=[];
   page.on('pageerror',e=>errors.push(e.message));const csp=fs.readFileSync(path.join(out,'_headers'),'utf8').match(/Content-Security-Policy: (.*)/)[1];
   await context.route('**/*',route=>{
    const u=new URL(route.request().url());if(u.origin!==origin){external.push(u.href);return route.abort();}
    const file=u.pathname==='/'?'index.html':u.pathname==='/app/'?'app/index.html':u.pathname.slice(1),p=path.join(out,file);
    if(!p.startsWith(out+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile())return route.fulfill({status:404,body:'Not a demo file'});
    return route.fulfill({status:200,body:fs.readFileSync(p),headers:{'content-type':file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html','content-security-policy':csp}});
   });
   async function compact(){
    const b=await page.locator('#iig-demo-banner').boundingBox(),button=await page.locator('#iig-demo-toggle').boundingBox();
    assert(b.y===0);assert(b.height<=48);assert(button.height>=44);assert.equal(await page.locator('#iig-demo-toggle span').first().textContent(),'DEMO MODE — Fictional data only');
    assert(await page.locator('#iig-demo-toggle span').first().evaluate(el=>el.getBoundingClientRect().height<=22));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   async function aboveNotice(locator){await locator.scrollIntoViewIfNeeded();const r=await locator.boundingBox(),b=await page.locator('#iig-demo-banner').boundingBox();assert(r.y>=b.y+b.height-1);assert(r.y+r.height<=page.viewportSize().height+1);}
   await page.goto(origin);await page.locator('#openingSplash').waitFor({state:'detached'});await compact();
   assert.equal(await page.locator('#demo-practice-tasks').isVisible(),false);await page.getByText("Golf. Mates. You're In.",{exact:true}).waitFor();await page.screenshot({path:'/tmp/iig-first-launch-'+viewport.width+'.png'});
   await aboveNotice(page.locator('#demo-welcome-start'));await page.locator('#iig-demo-toggle').click();
   const dialog=page.getByRole('dialog',{name:'Demonstration explanation'});await dialog.waitFor();
   for(let n=0;n<4;n++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('dialog')));}
   await page.keyboard.press('Escape');assert(await page.locator('#iig-demo-toggle').evaluate(el=>el===document.activeElement));
   await page.locator('#demo-welcome-start').click();await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await compact();
   await page.getByRole('link',{name:'Try being the organiser'}).click();await page.locator('#openingSplash').waitFor({state:'detached'});await compact();
   await page.getByRole('button',{name:'Start a golf group',exact:false}).first().click();await page.locator('#regName').fill('Alex Fictional');
   // Emulate a standalone safe top inset; actual env() values still need physical Safari review.
   await page.evaluate(()=>{document.documentElement.classList.add('iig-ios-fullscreen');document.documentElement.style.setProperty('--iig-demo-safe-top','24px');});
   await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--iig-demo-top'))>=69);
   assert.equal(await page.locator('.app').evaluate(el=>getComputedStyle(el).paddingTop),'0px');
   await page.locator('#regSetupEmail').fill('alex@example.test');await aboveNotice(page.locator('#regSetupEmail'));await aboveNotice(page.locator('#regCreate'));
   // A reduced visible height exercises scrolling/panel limits, not a real iOS keyboard.
   await page.setViewportSize({width:viewport.width,height:320});await page.locator('#regSetupEmail').focus();await aboveNotice(page.locator('#regSetupEmail'));
   await page.locator('#iig-demo-toggle').click();await dialog.waitFor();
   const d=await dialog.boundingBox(),b=await page.locator('#iig-demo-banner').boundingBox();assert(d.y>=b.y+b.height);assert(d.y+d.height<=320);assert(d.x>=0&&d.x+d.width<=viewport.width);
   await dialog.evaluate(el=>{el.scrollTop=el.scrollHeight;});await aboveNotice(page.locator('[data-demo-notice-close]'));await page.locator('[data-demo-notice-close]').click();
   assert.equal(await dialog.isVisible(),false);assert.equal(await page.locator('#regSetupEmail').inputValue(),'alex@example.test');await aboveNotice(page.locator('#regCreate'));
   await page.setViewportSize(viewport);await page.evaluate(()=>{document.documentElement.style.removeProperty('--iig-demo-safe-top');document.documentElement.classList.remove('iig-ios-fullscreen');});
   await compact();await page.screenshot({path:'/tmp/iig-compact-notice-'+viewport.width+'.png'});
   assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await context.close();
  }
  console.log('PASS: compact single-line demo notice, 44px tap target, modal explanation/keyboard focus, released welcome before tasks, phone/landscape layouts, safe-inset and short-viewport scrolling. Offline only.');
 }finally{await browser.close();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
