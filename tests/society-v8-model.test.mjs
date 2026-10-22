import {test} from 'node:test';
import assert from 'node:assert/strict';
import {seed,generateSeason,finance,syncBookings,setStatus,register,cancelRegistration,playerEvents,moveEvent} from '../app/society-v8-model.mjs';
test('v7-style season generates one or two recurring weekend fixtures with exclusions',()=>{
 const s=seed(),p={...s.season,frequency:2};const es=generateSeason(s,p);
 assert.equal(es.length,16);assert.ok(es.every(e=>new Date(e.date).getUTCDay()===0));
 assert.equal(generateSeason(s,{...p,avoid:es[0].date}).length,15);
 assert.ok(generateSeason(s,{...p,weekday:6}).every(e=>new Date(e.date).getUTCDay()===6));
 assert.throws(()=>generateSeason(s,{...p,end:'2020-01-01'}));
 assert.throws(()=>generateSeason(s,{...p,shortlist:[]}));
 s.competitions.forEach(c=>c.archived=true);assert.throws(()=>generateSeason(s,p));
});
test('CRM sync is idempotent and preserves notes and approvals',()=>{
 const s=seed(),note=s.bookings[0].notes[0].text;syncBookings(s);syncBookings(s);assert.equal(s.bookings.length,8);assert.equal(s.bookings[0].notes[0].text,note);
 s.events=generateSeason(s,s.season);syncBookings(s);assert.equal(s.bookings.length,16);assert.equal(s.bookings[0].notes[0].text,note);
});
test('confirmation requires recorded full deposit and Treasurer approval; cancellation is dated',()=>{
 const s=seed(),b=s.bookings[1];assert.throws(()=>setStatus(b,'Confirmed'));
 b.paid=b.deposit;assert.throws(()=>setStatus(b,'Confirmed'));b.treasurerApproved=true;setStatus(b,'Confirmed');assert.equal(b.status,'Confirmed');
 setStatus(b,'Cancelled');assert.ok(b.cancelledAt);assert.ok(b.history[0].text.includes('Cancelled'));
});
test('finance reconciles active bookings, weighted fees and subscription arrears',()=>{
 const s=seed();const f=finance(s);assert.equal(f.expected,12000);assert.equal(f.actual,1080);assert.equal(f.average,62.5);assert.equal(f.depositsPaid,900);assert.equal(f.depositsOutstanding,1400);assert.equal(f.averageDeposit,287.5);assert.equal(f.variance,10920);assert.equal(f.subscriptions,200);assert.equal(f.subscriptionsDue,120);s.bookings[0].status='Cancelled';assert.equal(finance(s).expected,10920);
});
test('players receive only explicit public fields; draft and unconfirmed events never appear',()=>{
 const s=seed();s.bookings[0].notes[0].text='SECRET_NEGOTIATION';const es=playerEvents(s,'m0');assert.equal(es.length,3);const text=JSON.stringify(es);assert.ok(!text.includes('SECRET'));assert.ok(!text.includes('example.invalid'));assert.ok(!text.includes('treasurerApproved'));assert.ok(!text.includes('expected'));
 s.season.state='approved';assert.equal(playerEvents(s,'m0').length,0);s.season.state='draft';assert.equal(playerEvents(s,'m0').length,0);
});
test('capacity, waiting list, guest limits, cancellation promotion and toggles',()=>{
 const s=seed(),e=s.events[0];e.capacity=19;e.baseBooked=18;
 assert.equal(register(s,e.id,'m0').status,'Confirmed');assert.equal(register(s,e.id,'m1').status,'Waiting list');cancelRegistration(s,e.id,'m0');assert.equal(s.registrations.find(r=>r.memberId==='m1').status,'Confirmed');
 s.features.guests=false;assert.throws(()=>register(s,e.id,'m2',1));s.features.waitingList=false;assert.throws(()=>register(s,e.id,'m2'));
 s.features.bookingLimits=false;assert.equal(register(s,e.id,'m2').status,'Confirmed');s.features.memberBookings=false;assert.throws(()=>register(s,e.id,'m3'));
});
test('reordering preserves event identity and linked booking records',()=>{
 const s=seed(),id=s.events[0].id;moveEvent(s.events,0,2);assert.equal(s.events[2].id,id);assert.equal(s.bookings[0].eventId,id);moveEvent(s.events,0,-1);assert.equal(s.events.length,8);
});
