/* Owner-page adapter only. Uses the existing verified-session request's headers,
 * timeout and cancellation. Does not own credentials, refresh sessions or write data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.IIGOwnerReads=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const scalar=v=>v===null||['string','number','boolean'].includes(typeof v);
 function overview(value,offset){
  if(!value||value.scope!=='all_preserved_groups'||value.offset!==offset||!Number.isSafeInteger(value.total_groups)||value.total_groups<0||!Array.isArray(value.groups)||value.groups.length>100||typeof value.has_more!=='boolean')throw Error('Owner register scope or response could not be confirmed.');
  const pins=new Set();for(const g of value.groups){if(!g||!/^\d{4}$/.test(g.group_pin)||pins.has(g.group_pin)||Object.values(g).some(v=>!scalar(v)))throw Error('Owner register response could not be confirmed.');pins.add(g.group_pin);}
  if(value.groups.length!==Math.min(100,Math.max(0,value.total_groups-offset))||value.has_more!==(offset+value.groups.length<value.total_groups))throw Error('Owner register pagination changed. Refresh groups.');
  return value;
 }
 function create({fetch:send,access}){
  const base=new URL(access.url);
  async function load(offset,options){
   if(!Number.isSafeInteger(offset)||offset<0||offset%100!==0||!new Headers(options.headers).has('Authorization'))throw Error('Verified owner request required.');
   const post=(name,body)=>send(new URL('/rest/v1/rpc/'+name,base).href,{...options,method:'POST',cache:'no-store',body:JSON.stringify(body)});
   const response=await post('iig_owner_group_overview',{p_offset:offset});
   if(!response.ok)return {response};
   const data=overview(await response.json(),offset),details=new Map();let next=0,denied=null;
   // Bounded fan-out; every read independently enforces verified platform ownership.
   await Promise.all(Array.from({length:Math.min(4,data.groups.length)},async()=>{while(next<data.groups.length&&!denied){const g=data.groups[next++];try{
    const r=await post('iig_owner_group_detail',{p_pin:g.group_pin});
    if(r.status===401||r.status===403){denied=r;break;}
    if(!r.ok){details.set(g.group_pin,null);continue;}
    const d=await r.json();if(!d||d.group_pin!==g.group_pin)throw Error('Owner detail group mismatch.');details.set(g.group_pin,d);
   }catch(e){if(options.signal?.aborted)throw e;details.set(g.group_pin,null);}}}));
   if(denied)return {response:denied};
   return {overview:data,details,response:new Response(JSON.stringify(data.groups),{status:200,headers:{'Content-Type':'application/json'}})};
  }
  return {load};
 }
 return {overview,create};
});
