// Offline DOM events: invalid edits must be rejected intact, including paste/selection.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const {document,Event}=parseHTML('<html><body><input id="h"></body></html>');
const ctx={document};ctx.window=ctx;vm.runInNewContext(fs.readFileSync('app/handicap-input.js','utf8'),ctx);
const input=document.getElementById('h');input.value='';input.setSelectionRange=(a,b)=>{input.selectionStart=a;input.selectionEnd=b;};ctx.iigHandicap.bind(input);
function edit(text,kind='typing'){
 const before=input.value;input.selectionStart??=before.length;input.selectionEnd??=input.selectionStart;
 const start=input.selectionStart,end=input.selectionEnd;
 const event=new Event(kind==='paste'?'paste':'beforeinput',{cancelable:true});
 if(kind==='paste')event.clipboardData={getData:()=>text};else {event.inputType='insertText';event.data=text;}
 input.dispatchEvent(event);
 if(!event.defaultPrevented){input.value=before.slice(0,start)+text+before.slice(end);input.selectionStart=input.selectionEnd=start+text.length;input.oninput();}
 return input.value;
}
function reset(value=''){input.value=value;input.oninput();input.selectionStart=input.selectionEnd=input.value.length;}
for(const example of ['11.2','12','22.7','8.5','0','-1.2']){
 reset();for(const c of example)edit(c);assert.equal(input.value,example);
 reset();assert.equal(edit(example,'paste'),example);
}
for(const invalid of ['112','120','227','11.22','1.2.3','1e2','1,2','abc',' 11.2 ','11.2\n']){
 reset('8.5');input.selectionStart=0;input.selectionEnd=3;assert.equal(edit(invalid,'paste'),'8.5');
}
reset('12');assert.equal(edit('0'),'12');assert.equal(edit('.'),'12.');assert.equal(edit('3'),'12.3');assert.equal(edit('4'),'12.3');
reset('22.7');input.selectionStart=0;input.selectionEnd=2;assert.equal(edit('8'),'8.7');
// Simulate an input source without beforeinput (autofill/drop/older webviews).
reset('11.2');input.value='227';input.oninput();assert.equal(input.value,'11.2');
for(const value of ['-10','60','11.2'])assert(ctx.iigHandicap.valid(value));
for(const value of ['61','-10.1','112','11.22','11.',''])assert(!ctx.iigHandicap.valid(value));
assert.equal(input.getAttribute('inputmode'),'decimal');assert.equal(input.hasAttribute('maxlength'),false);
// Binding a saved value must not rewrite it, including unusual historical data.
const historic=document.createElement('input');historic.value='112';ctx.iigHandicap.bind(historic);assert.equal(historic.value,'112');
console.log('PASS: handicap typing/paste, third-digit rejection, selection edits, input fallback, decimal keyboard, final range validation and no rewriting of saved values.');
