/* Shared input guard: reject invalid edits as a whole; never guess or truncate a handicap. */
(() => {
 'use strict';
 const partial = value => /^-?(?:[0-9]{0,2}|[0-9]{1,2}\.[0-9]?)$/.test(value);
 const valid = value => /^-?[0-9]{1,2}(?:\.[0-9])?$/.test(String(value)) && Number(value)>=-10 && Number(value)<=60;
 const bound=new WeakSet();
 function bind(input){
  if(!input || bound.has(input))return;
  bound.add(input);input.type='text';input.inputMode='decimal';input.setAttribute('inputmode','decimal');
  input.setAttribute('autocomplete','off');input.setAttribute('pattern','-?[0-9]{1,2}([.][0-9])?');
  // Do not use maxlength: browsers can truncate a pasted invalid value before validation.
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
 window.iigHandicap={bind,partial,valid};
})();
