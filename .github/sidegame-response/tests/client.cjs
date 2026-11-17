const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let source=fs.readFileSync(require('node:path').join(__dirname,'../../../app/secure-player.js'),'utf8');
const names=source.match(/const old=\{([^}]+)\}/)[1].split(',');
const response={children:[],set textContent(v){this.text=v;this.children=[];},appendChild(v){this.children.push(v);}};
const c={console,document:{getElementById:id=>id==='sideGameChallengeResponse'?response:null,createElement:()=>({})},state:{roundId:'r'},sideGameOpen:true,scoreDraftActive:false};c.window=c;c.IIG_ACCOUNT_ACCESS=true;
for(const name of names)c[name]=()=>{};
source=source.replace(/\}\)\(\);\s*$/,"window.testSetup=(request)=>{active={pin:'7771',request};revision=1;};})();");
vm.createContext(c);vm.runInContext(source,c);
(async()=>{
 let writes=0;c.testSetup(async()=>{writes++;throw Error('INVALID_CHALLENGE_RESPONSE');});
 assert.equal(await c.sideGameDeclineChallenge('invite'),false);
 assert.match(response.text,/INVALID_CHALLENGE_RESPONSE/);assert.equal(response.children[0].textContent,'Reload challenges');
 assert.equal(await c.sideGameAcceptChallenge('invite'),false);assert.equal(writes,1);assert.match(response.text,/Reload group/);
 console.log('PASS failed response visible beside challenge; recovery offered; blocked action never retries a write');
})().catch(e=>{console.error(e);process.exitCode=1;});
