// Isolated v8 domain model. No network, production config or v7 storage access.
export const KEY='imingolf_society_v8_demo_1';
export const statuses=['Not Started','In Progress','Discussion Ongoing','Provisionally Booked','Awaiting Treasurer','Deposit Paid','Confirmed','Fully Booked','Awaiting Refund','Cancelled','Unavailable','On Hold'];
export const features={memberBookings:'Member bookings',guests:'Guest bookings',waitingList:'Waiting lists',bookingLimits:'Booking limits',league:'Annual league & results',twos:'Twos',fines:'Society fines',prizes:'Nearest the Pin & Longest Drive',honours:'Honours Board',draw:'Automatic tee draw',special:'Captain’s Day & special events',gallery:'Photo gallery',buggy:'Buggy requests',diet:'Dietary requirements',treasurer:'Treasurer',subscriptions:'Annual subscriptions'};
export const facilities={buggies:'Buggies',catering:'Catering',practice:'Practice facilities',accessible:'Accessible clubhouse',winterGreens:'Winter greens',saturdayComps:'Saturday competitions',lateTees:'Late tee availability'};
export const uid=()=>globalThis.crypto.randomUUID();
export const today=()=>new Date().toISOString().slice(0,10);
export const stamp=()=>new Date().toISOString();
export function seed(){
 const names=['Meadow Park','Oak Valley','Riverside Abbey','Hillcrest','Willow Grove','Pine Ridge','Brook Hall','Lakeside'];
 const clubs=names.map((name,i)=>({id:'c'+i,name:name+' Golf Club',location:['Cheshire','Staffordshire','Derbyshire'][i%3],contact:'Demo bookings team',email:'bookings'+i+'@example.invalid',phone:'Fictional contact — do not call',fee:45+i*5,cateringCost:12,buggyCost:25,rating:8,preference:i<5?'Preferred':'Reserve',notes:'Fictional previous visit: welcoming clubhouse; check winter course conditions.',followup:'Request society availability and written terms.',facilities:Object.fromEntries(Object.keys(facilities).map(k=>[k,!['winterGreens','saturdayComps'].includes(k)]))}));
 const competitions=['Spring Cup','Founders Cup','Summer Trophy','Captain’s Trophy','Autumn Cup','President’s Cup','Society Shield','Finale Cup'].map((name,i)=>({id:'q'+i,name,format:i===5?'Net':'Stableford',sponsor:i%2?'Example Local Sponsor':'',archived:false}));
 const dates=['2027-03-14','2027-04-11','2027-05-09','2027-07-17','2027-08-15','2027-09-05','2027-09-19','2027-10-03'];
 const events=dates.map((date,i)=>({id:'e'+i,date,clubId:'c'+i,competitionId:'q'+i,type:i===3?'Captain’s Weekend':'Golf day',sponsor:competitions[i].sponsor,tee:'10:00',catering:'Coffee, breakfast roll and lunch',capacity:24,baseBooked:i===0?18:12,price:clubs[i].fee,format:competitions[i].format,results:i===7?[{name:'Jamie Demo',score:36,twos:1},{name:'Alex Demo',score:33,twos:0}]:[],draw:[],prizes:{nearest:'Jamie Demo',longest:'Alex Demo'}}));
 const bookings=events.map((e,i)=>({id:'b'+i,eventId:e.id,status:['Confirmed','Awaiting Treasurer','Deposit Paid','Not Started','In Progress','Fully Booked','On Hold','Confirmed'][i],followup:'2026-10-28',availability:'Provisional society allocation',tee:e.tee,capacity:24,expected:clubs[i].fee*24,actual:i===0?1080:0,deposit:200+i*25,paid:[0,5,7].includes(i)?200+i*25:0,depositDue:'2027-02-01',treasurerApproved:[0,5,7].includes(i),confirmation:[0,5,7].includes(i)?'DEMO-CONF-'+i:'',cancelledAt:'',updated:'2026-10-15T12:00:00.000Z',notes:[{at:'2026-10-15T12:00:00.000Z',text:'Fictional internal note: request written society terms.'}],history:[{at:'2026-10-15T12:00:00.000Z',text:'Created from v7-style fixture plan'}]}));
 return {version:1,society:'Fairway Golf Society',features:Object.fromEntries(Object.keys(features).map(k=>[k,true])),ratingMax:10,budget:12000,subscription:40,clubs,competitions,season:{start:'2027-03-01',end:'2027-10-31',frequency:1,weekday:0,ordinal:2,secondOrdinal:4,avoid:'',rules:'Avoid local club championship weekends; confirm availability before approval.',shortlist:clubs.slice(0,5).map(c=>c.id),state:'published'},events,bookings,registrations:[],members:['Jamie Demo','Alex Demo','Sam Demo','Morgan Demo','Casey Demo','Taylor Demo','Jordan Demo','Robin Demo'].map((name,i)=>({id:'m'+i,name,paid:i<5?40:0})),fines:[{id:'f1',memberId:'m1',reason:'Forgot the trophy (fictional)',amount:2,status:'Approved'}],albums:[{title:'Spring Society Day',caption:'Illustration only — no member photos',symbol:'⛳'},{title:'Trophy presentation',caption:'Illustration only',symbol:'🏆'}]};
}
export function activity(booking,text){const at=stamp();booking.updated=at;booking.history.unshift({at,text});}
export function generateSeason(state,config){
 if(!config.start||!config.end||config.start>config.end)throw Error('Choose a valid start and end date.');
 const start=new Date(config.start+'T12:00:00Z'),end=new Date(config.end+'T12:00:00Z');
 if((end-start)/86400000>732)throw Error('Plan no more than two years at once.');
 const clubs=state.clubs.filter(c=>config.shortlist.includes(c.id));const comps=state.competitions.filter(c=>!c.archived);
 if(!clubs.length||!comps.length)throw Error('Choose at least one shortlisted club and one active competition.');
 const avoid=new Set(config.avoid.split(/[\s,]+/).filter(Boolean));const dates=[];
 for(let month=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1,12));month<=end;month.setUTCMonth(month.getUTCMonth()+1)){
  const first=new Date(month),offset=(Number(config.weekday)-first.getUTCDay()+7)%7;
  const ordinals=config.frequency===2?[config.ordinal,config.secondOrdinal]:[config.ordinal];
  for(const ordinal of [...new Set(ordinals.map(Number))]){
   const d=new Date(first);d.setUTCDate(1+offset+(ordinal-1)*7);const date=d.toISOString().slice(0,10);
   if(d.getUTCMonth()===first.getUTCMonth()&&d>=start&&d<=end&&!avoid.has(date))dates.push(date);
  }
 }
 if(!dates.length)throw Error('No dates match these preferences. Adjust the date range or exclusions.');
 return dates.sort().map((date,i)=>({id:uid(),date,clubId:clubs[i%clubs.length].id,competitionId:comps[i%comps.length].id,sponsor:comps[i%comps.length].sponsor,format:comps[i%comps.length].format,type:'Golf day',tee:'10:00',catering:'Coffee and breakfast roll',capacity:24,baseBooked:0,price:clubs[i%clubs.length].fee,results:[],draw:[],prizes:{nearest:'',longest:''}}));
}
export function syncBookings(state){
 for(const e of state.events)if(!state.bookings.some(b=>b.eventId===e.id))state.bookings.push({id:uid(),eventId:e.id,status:'Not Started',followup:'',availability:'Awaiting club response',tee:e.tee,capacity:e.capacity,expected:e.price*e.capacity,actual:0,deposit:0,paid:0,depositDue:'',treasurerApproved:false,confirmation:'',cancelledAt:'',updated:stamp(),notes:[],history:[{at:stamp(),text:'Created from season planner'}]});
}
export function setStatus(b,status){
 if(!statuses.includes(status))throw Error('Unknown booking status.');
 if(['Confirmed','Fully Booked'].includes(status)&&b.deposit>0&&(!b.treasurerApproved||b.paid<b.deposit))throw Error('Treasurer approval and the full deposit record are required before confirmation.');
 if(status==='Cancelled')b.cancelledAt=stamp();
 b.status=status;activity(b,'Status changed to '+status);
}
export const activeBookings=s=>s.bookings.filter(b=>s.events.some(e=>e.id===b.eventId)&&!['Cancelled','Unavailable','Awaiting Refund'].includes(b.status));
export function finance(s){const bs=activeBookings(s),sum=k=>bs.reduce((n,b)=>n+Number(b[k]||0),0),places=bs.reduce((n,b)=>n+Number(b.capacity),0),expected=sum('expected'),actual=sum('actual'),deposit=sum('deposit'),paid=sum('paid');return{budget:s.budget,expected,actual,average:places?expected/places:0,depositsPaid:paid,depositsOutstanding:Math.max(0,deposit-paid),averageDeposit:bs.length?deposit/bs.length:0,variance:s.budget-actual,subscriptions:s.members.reduce((n,m)=>n+m.paid,0),subscriptionsDue:s.members.reduce((n,m)=>n+Math.max(0,s.subscription-m.paid),0)};}
export function usedPlaces(s,e,excludingMember=null){return e.baseBooked+s.registrations.filter(r=>r.eventId===e.id&&r.memberId!==excludingMember&&r.status==='Confirmed').reduce((n,r)=>n+1+r.guests,0);}
export function register(s,eventId,memberId,guests=0,extra={}){
 if(s.season.state!=='published'||!s.features.memberBookings)throw Error('Member bookings are not open.');
 const e=s.events.find(e=>e.id===eventId),b=s.bookings.find(b=>b.eventId===eventId);
 if(!e||!b||!['Confirmed','Fully Booked'].includes(b.status))throw Error('This fixture is not open for player bookings.');
 if(!Number.isInteger(guests)||guests<0||guests>3||(!s.features.guests&&guests))throw Error('Guest booking is not available.');
 const full=usedPlaces(s,e,memberId)+1+guests>e.capacity;
 if(full&&s.features.bookingLimits&&!s.features.waitingList)throw Error('This golf day is full.');
 let r=s.registrations.find(r=>r.eventId===eventId&&r.memberId===memberId);
 if(!r){r={eventId,memberId,paid:0};s.registrations.push(r);}
 Object.assign(r,{guests,status:full&&s.features.bookingLimits?'Waiting list':'Confirmed',buggy:s.features.buggy?extra.buggy||'No':'No',diet:s.features.diet?extra.diet||'None':'None'});return r;
}
export function cancelRegistration(s,eventId,memberId){const r=s.registrations.find(r=>r.eventId===eventId&&r.memberId===memberId);if(r)r.status='Declined';promoteWaiting(s,eventId);}
export function promoteWaiting(s,eventId){if(!s.features.waitingList)return;const e=s.events.find(e=>e.id===eventId);for(const r of s.registrations.filter(r=>r.eventId===eventId&&r.status==='Waiting list')){if(!s.features.bookingLimits||usedPlaces(s,e)+1+r.guests<=e.capacity)r.status='Confirmed';}}
// Explicit public projection: admin notes, contact records, budgets, draft events and CRM never enter player rendering.
export function playerEvents(s,memberId){if(s.season.state!=='published')return[];return s.events.filter(e=>['Confirmed','Fully Booked'].includes(s.bookings.find(b=>b.eventId===e.id)?.status)).map(e=>({id:e.id,date:e.date,club:s.clubs.find(c=>c.id===e.clubId)?.name||'Venue to confirm',competition:s.competitions.find(c=>c.id===e.competitionId)?.name||'Society golf day',type:s.features.special?e.type:'Golf day',tee:e.tee,catering:e.catering,price:e.price,format:e.format,capacity:e.capacity,remaining:Math.max(0,e.capacity-usedPlaces(s,e)),sponsor:e.sponsor,results:e.results.map(r=>({name:r.name,score:r.score,...(s.features.twos?{twos:r.twos}:{})})),draw:s.features.draw?e.draw:[],prizes:s.features.prizes?e.prizes:null,booking:s.registrations.filter(r=>r.eventId===e.id&&r.memberId===memberId).map(r=>({status:r.status,guests:r.guests,paid:r.paid,buggy:r.buggy,diet:r.diet}))[0]||null}));}
export function moveEvent(events,from,to){if(from<0||to<0||from>=events.length||to>=events.length)return;events.splice(to,0,events.splice(from,1)[0]);}
