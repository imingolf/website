const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTapRouter}=require('../../../app/native-reminders.js');
function fixture(){
 const data=new Map(),calls={opened:0,reads:0,warnings:0,routes:[]};let uid='owner',invites=[{id:'invite'}];
 const p={active:true,identity:{groupPin:'7196'},canSwitchView:true,async reloadForPayment(){calls.reads++;return true;}};
 const o={active:false};
 const deps={storage:()=>({getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}),user:()=>uid,player:()=>p,organiser:()=>o,openPlayer:async()=>{p.active=true;o.active=false;},navigate:pin=>calls.routes.push(pin),pending:()=>invites,openInvite:async()=>calls.opened++,warn:()=>calls.warnings++};
 return {calls,p,o,deps,router:createTapRouter(deps),setUser:v=>uid=v,setInvites:v=>invites=v};
}
test('same group tap reloads and opens pending challenge once',async()=>{const f=fixture();await f.router.open('7196');await f.router.resume();assert.equal(f.calls.reads,1);assert.equal(f.calls.opened,1);assert.deepEqual(f.calls.routes,[]);});
test('cold start route survives page reload until verified player is ready',async()=>{const f=fixture();f.p.active=false;f.setUser(null);await f.router.open('7196');assert.deepEqual(f.calls.routes,['7196']);f.router=createTapRouter(f.deps);await f.router.resume();assert.equal(f.calls.opened,0);f.setUser('owner');f.p.active=true;await f.router.resume();assert.equal(f.calls.opened,1);});
test('other group does not display current group invitations',async()=>{const f=fixture();await f.router.open('1234');await f.router.resume();assert.equal(f.calls.opened,0);assert.deepEqual(f.calls.routes,['1234']);f.p.identity.groupPin='1234';await f.router.resume();assert.equal(f.calls.opened,1);});
test('completed or expired invitations never reopen a challenge',async()=>{const f=fixture();f.setInvites([]);await f.router.open('7196');assert.equal(f.calls.opened,0);assert.equal(f.calls.reads,1);});
test('unfinished score and failed refresh cannot navigate',async()=>{const f=fixture();f.p.canSwitchView=false;await f.router.open('7196');assert.equal(f.calls.reads,0);assert.equal(f.calls.warnings,1);f.p.canSwitchView=true;f.p.reloadForPayment=async()=>false;await f.router.open('7196');assert.equal(f.calls.opened,0);assert.equal(f.calls.warnings,2);});
test('account change during refresh invalidates tap',async()=>{const f=fixture();let finish;f.p.reloadForPayment=()=>new Promise(r=>finish=r);const task=f.router.open('7196');f.setUser('other');f.router.accountChanged();finish(true);await task;assert.equal(f.calls.opened,0);});
test('organiser uses verified own-player path, never selects another player',async()=>{const f=fixture();f.o.active=true;f.o.groupPin='7196';f.o.canSwitchView=true;f.p.active=false;await f.router.open('7196');assert.equal(f.calls.opened,1);});
test('invalid PIN and signout clear cannot navigate',async()=>{const f=fixture();await f.router.open('bad');assert.equal(f.calls.reads,0);f.p.active=false;await f.router.open('7196');f.router.clear();f.p.active=true;await f.router.resume();assert.equal(f.calls.opened,0);});
test('bound route waits while the verified session is restored after reload',async()=>{const f=fixture();f.p.active=false;await f.router.open('7196');f.router=createTapRouter(f.deps);f.setUser(null);await f.router.resume();f.setUser('owner');f.p.active=true;await f.router.resume();assert.equal(f.calls.opened,1);});
