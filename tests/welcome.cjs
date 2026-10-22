const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('app/index.html','utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>!m[1].includes('src='));
for(const m of scripts)new vm.Script(m[2]);
const script=scripts.find(m=>m[2].includes('function showWelcomePanel')).at(2);
const elements=new Map(),visible=new Set(['welcomeHome']);let focus='';
function el(id){if(!elements.has(id))elements.set(id,{tagName:id==='pinInput'?'INPUT':'H1',classList:{toggle(c,hide){hide?visible.delete(id):visible.add(id)}},focus(){focus=id},setAttribute(){}});return elements.get(id)}
const ctx={document:{getElementById:el,querySelector:s=>el(s)},Object};vm.runInNewContext(script,ctx);
for(const [panel,id] of [['join','welcomeJoin'],['start','welcomeStart'],['how','welcomeHow'],['home','welcomeHome']]){ctx.showWelcomePanel(panel);assert.deepEqual([...visible],[id]);}
ctx.showWelcomePanel('join');assert.equal(focus,'pinInput');focus='unchanged';ctx.showWelcomePanel('join',false);assert.equal(focus,'unchanged');
assert.ok(html.includes('onsubmit="event.preventDefault();connect()"'));
assert.ok(html.includes('mailto:hello@imingolf.co.uk?subject='));
assert.ok(!/organiser-test|player-test|group-setup-preview|nyavvwrsrxqfyhiygkgw/.test(html));
console.log(`PASS: ${scripts.length} inline scripts parse; four welcome panels, focus and non-focus navigation, existing PIN connect and email request route; no test-client links.`);
