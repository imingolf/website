// No database engine, SQL, migrations, hosted services or browser network calls.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {spawnSync}=require('node:child_process');
process.chdir(path.join(__dirname,'..'));
for(const file of fs.readdirSync('app').filter(f=>f.endsWith('.html'))){
 const html=fs.readFileSync(path.join('app',file),'utf8');
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script[1],{filename:file});
}
for(const file of fs.readdirSync('app').filter(f=>f.endsWith('.js')))new vm.Script(fs.readFileSync(path.join('app',file),'utf8'),{filename:file});
const suites=['handicap-input.cjs','guided-competition.cjs','sync-regression.cjs','group-setup-preview.cjs','organiser-test.cjs','secure-organiser.cjs','secure-player.cjs','self-service-dom.cjs','account-controls.cjs','account-delete.test.mjs','subscription-security.test.mjs'];
if(process.env.TEST_BROWSER)suites.push('self-service.cjs','guided-registration-browser.cjs');
for(const file of suites){
 const result=spawnSync(process.execPath,[path.join('tests',file)],{stdio:'inherit',env:process.env});
 if(result.status!==0){console.error('FAIL:',file,result.error||result.status);process.exit(1);}
}
console.log(`PASS: ${suites.length} offline suites and all app scripts parse. No SQL or migrations executed.`);
