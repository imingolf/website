const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/index.html'),'utf8');
function extract(name){
  const start=source.search(new RegExp('^(?:async )?function '+name+'\\(','m'));
  if(start<0)throw Error('Missing function '+name);
  const endings=/\n[ \t]*}/g;endings.lastIndex=start;
  for(let match;(match=endings.exec(source));){
    const candidate=source.slice(start,endings.lastIndex);
    try{new vm.Script(candidate);return candidate;}catch{}
  }
  throw Error('Cannot extract '+name);
}

const ctx={state:{groupName:'10ers In',sideGame:{bets:[]}},myPlayerId:'recipient',pin:'7196',sideGameToday:()=> '2026-11-17'};
vm.createContext(ctx);
for(const name of ['sideGamePendingInvites','sideGameInviteMessage'])vm.runInContext(extract(name),ctx);
const invite={id:'invite1',player1Id:'sender',player1Name:'Greg',player2Id:'recipient',status:'pending',setup:'challenge',date:'2026-11-17',format:'match',stake:5};
ctx.state.sideGame.bets=[invite,{...invite,id:'other',player2Id:'someone-else'},{...invite,id:'old',date:'2026-11-16'},{...invite,id:'accepted',status:'active'}];
assert.deepEqual(Array.from(ctx.sideGamePendingInvites(),b=>b.id),['invite1']);
assert.equal(ctx.sideGameInviteMessage('invite1'),null);
ctx.myPlayerId='sender';
assert.match(ctx.sideGameInviteMessage('invite1'),/Match Play · £5/);
assert.match(ctx.sideGameInviteMessage('invite1'),/https:\/\/imingolf.co.uk\/app\/\?pin=7196/);
assert.equal(ctx.sideGameInviteMessage('accepted'),null);
ctx.myPlayerId='';assert.equal(ctx.sideGamePendingInvites().length,0);
ctx.myPlayerId='sender';ctx.pin='invalid';assert.equal(ctx.sideGameInviteMessage('invite1'),null);
for(const match of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
console.log('PASS recipient isolation, date/status filtering, sender-only sharing, invalid group protection and inline JavaScript syntax');
