// Offline suites: HTTP is mocked and PostgreSQL runs in memory. No hosted writes.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
process.chdir(path.join(__dirname,'..'));
for(const file of fs.readdirSync('app').filter(f=>f.endsWith('.html'))){
 const html=fs.readFileSync(path.join('app',file),'utf8');
 for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(script[1],{filename:file});
}
for(const file of ['app/self-service.js','app/secure-organiser.js','app/secure-player.js','app/account-controls.js'])new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});
for(const file of ['supabase/functions/account-delete/index.ts','supabase/functions/verify-apple-subscription/index.ts']){const checked=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(checked.status!==0)process.exit(1);}
console.log('PASS: Edge TypeScript entry points parse (Deno runtime/dependencies require staging verification).');
console.log('PASS: all app inline scripts and protected integration modules parse.');
const suites=['tests/guided-competition.cjs','tests/handicap-input.cjs','tests/sync-regression.cjs','tests/group-setup-preview.cjs','tests/organiser-test.cjs','tests/secure-organiser.cjs','tests/secure-player.cjs','tests/self-service-dom.cjs','tests/account-controls.cjs','tests/account-delete.test.mjs','tests/subscription-security.test.mjs','security-tests/gameplay.test.mjs','security-tests/access.test.mjs','security-tests/setup-bundle.test.mjs'];
if(process.env.TEST_BROWSER)suites.push('tests/self-service.cjs','tests/guided-registration-browser.cjs');
for(const file of suites){
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',env:process.env});
 if(result.status!==0){console.error('FAIL:',file,result.error||result.signal||result.status);process.exit(1);}
}
console.log(`PASS: ${suites.length} suites. Hosted email/JWT, concurrency and physical iPhone checks remain manual.`);
