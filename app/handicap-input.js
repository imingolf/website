/* Shared input guard and display formatter for golf handicaps. */
(() => {
 'use strict';
 const partial = value => /^[+-]?(?:[0-9]{0,2}|[0-9]{1,2}\.[0-9]?)$/.test(value);
 const parse = raw => {
  const text=String(raw??'').trim();
  const value=Number(text);
  return text.startsWith('+') ? -Math.abs(value) : value;
 };
 const valid = raw => {
  const text=String(raw??'').trim();
  return /^[+-]?[0-9]{1,2}(?:\.[0-9])?$/.test(text) && Number.isFinite(parse(text)) && parse(text)>=-10 && parse(text)<=60;
 };
 const format = value => {
  if(value===null||value===undefined||value==='')return '—';
  const number=Number(value);
  if(!Number.isFinite(number))return String(value);
  return number<0 ? '+'+String(Math.abs(number)) : String(number);
 };
 const limit = value => {
  const raw=String(value);
  const sign=raw.startsWith('-')||raw.startsWith('+') ? raw[0] : '';
  const digits=raw.slice(sign.length).replace(/[^0-9.]/g,'');
  const dot=digits.indexOf('.');
  const whole=(dot<0?digits:digits.slice(0,dot)).replace(/\D/g,'').slice(0,2);
  if(dot<0)return sign+whole;
  const decimal=digits.slice(dot+1).replace(/\D/g,'').slice(0,1);
  return sign+(whole||'0')+'.'+decimal;
 };
 const bound=new WeakSet();
 function bind(input){
  if(!input || bound.has(input))return;
  bound.add(input);input.type='text';input.inputMode='text';input.setAttribute('inputmode','text');
  input.setAttribute('autocomplete','off');input.setAttribute('pattern','[+-]?[0-9]{1,2}([.][0-9])?');
  input.removeAttribute('maxlength');
  let previous=String(input.value||''),start=previous.length,end=start;
  const remember=()=>{previous=input.value;start=input.selectionStart??previous.length;end=input.selectionEnd??start;};
  const replacement=text=>input.value.slice(0,input.selectionStart??input.value.length)+text+input.value.slice(input.selectionEnd??input.value.length);
  input.addEventListener('beforeinput',event=>{
   remember();
   if(event.inputType?.startsWith('insert') && event.data!=null && !partial(replacement(event.data)))event.preventDefault();
  });
  input.addEventListener('paste',event=>{
   const text=event.clipboardData?.getData('text');
   if(text==null)return;
   remember();if(!partial(replacement(text)))event.preventDefault();
  });
  input.oninput=()=>{
   if(partial(input.value)){remember();return;}
   input.value=previous;input.setSelectionRange?.(start,end);
  };
 }
 window.iigHandicap={bind,partial,valid,parse,format,limit};
})();