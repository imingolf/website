const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(__dirname+'/../../app/index.html','utf8');
const js=fs.readFileSync(__dirname+'/../../app/entry-guard-client.js','utf8');
const {extract}=(()=>{const source=html;return {extract(name){const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));const ends=/\n[ \t]*}/g;ends.lastIndex=start;for(let m;(m=ends.exec(source));){const code=source.slice(start,ends.lastIndex);try{new vm.Script(code);return code;}catch{}}throw Error('Missing function');}};})();
let requests=0;const sandbox={fetch(){requests++;throw Error('No network');},localStorage:{setItem(){throw Error('No credentials persisted');}},sessionStorage:{setItem(){throw Error('No credentials persisted');}}};
vm.runInNewContext(js,sandbox);assert.equal(requests,0);assert.ok(sandbox.IIGEntryGuard);
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
for(const name of ['finishRoundImpl','finishTripBetterBallRound']){assert.match(extract(name),/save\("finish"\)/);assert.doesNotMatch(extract(name),/await save\(\)/);}
for(const name of ['setupFirstRound','newRound','nextTripRound']){assert.match(extract(name),/save\("start"\)/);assert.doesNotMatch(extract(name),/await save\(\)/);}
assert.match(extract('save'),/capture\(sourceState,pin\)/);assert.match(extract('save'),/commit\(operation/);
const connect=extract('connect');assert.ok(connect.indexOf('validateBuild')<connect.indexOf('createClient'));
assert.match(connect,/db=iigEntryBridge\?iigEntryBridge.db:rawDb/);
const TEST='nyavvwrsrxqfyhiygkgw';const build={mode:'test-only',projectRef:TEST,origin:'https://fixture.invalid'};
for(const [b,c,o] of [[{}, {},build.origin],[build,{supabaseUrl:'https://kzzzputsqxdntfqpprnz.supabase.co'},build.origin],[build,{supabaseUrl:'https://'+TEST+'.supabase.co'},'https://wrong.invalid'],[null,{},build.origin]])
 assert.throws(()=>sandbox.IIGEntryGuard.validateBuild(b,c,o),/GUARDED_TEST_CONFIG_REQUIRED/);
assert.equal(requests,0);
console.log('PASS: actual app script syntax and explicit lifecycle routing; inert module, no storage/network on load, invalid guarded configuration rejected before client creation. Offline source/VM checks only.');
