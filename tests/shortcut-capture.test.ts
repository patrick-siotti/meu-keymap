import test from "node:test";
import assert from "node:assert/strict";
import { markerKeys } from "../lib/bindings.ts";
import { captureShortcutKey,emptyCapture } from "../lib/shortcut-capture.ts";
import type { ShortcutKeyEvent } from "../lib/shortcut-capture.ts";
const event=(key:string,patch:Partial<ShortcutKeyEvent>={}):ShortcutKeyEvent=>({key,code:key,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,...patch});
test("all 75 native marker bursts are ignored by an armed shortcut capture, then the intended shortcut is accepted",()=>{
  for(let index=0;index<75;index++){
    let pending=emptyCapture();
    for(const [i,code] of markerKeys(index).entries()){
      const key=`F${code+20-111}`,decision=captureShortcutKey(pending,event(key));pending=decision.pending;assert.equal(decision.kind,i===3?"marker":"wait");
    }
    assert.deepEqual(pending,emptyCapture());
    assert.deepEqual(captureShortcutKey(pending,event("c",{code:"KeyC",ctrlKey:true})),{kind:"capture",pending:emptyCapture(),chord:"Ctrl+C"});
  }
});
test("individual function keys, modifiers, ordinary chords, invalid prefixes and cancellation stay distinct",()=>{
  for(let n=1;n<=23;n++){const decision=captureShortcutKey(emptyCapture(),event(`F${n}`));assert.equal(decision.kind,"capture");if(decision.kind==="capture")assert.equal(decision.chord,`F${n}`);}
  const pending=captureShortcutKey(emptyCapture(),event("F24")).pending;assert.equal(pending.first,"F24");
  assert.equal(captureShortcutKey(pending,event("F24",{repeat:true})).kind,"ignore");
  assert.equal(captureShortcutKey(pending,event("Escape")).kind,"cancel");
  const fallback=captureShortcutKey(pending,event("A",{code:"KeyA"}));assert.equal(fallback.kind,"capture");if(fallback.kind==="capture")assert.equal(fallback.chord,"F24");
  const modified=captureShortcutKey(emptyCapture(),event("F24",{ctrlKey:true}));assert.equal(modified.kind,"capture");if(modified.kind==="capture")assert.equal(modified.chord,"Ctrl+F24");
  assert.equal(captureShortcutKey(emptyCapture(),event("Control")).kind,"ignore");
  const capture=captureShortcutKey(emptyCapture(),event("S",{code:"KeyS",shiftKey:true,metaKey:true}));assert.equal(capture.kind,"capture");if(capture.kind==="capture")assert.equal(capture.chord,"Shift+Win+S");
});
