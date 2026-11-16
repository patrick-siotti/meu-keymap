import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindingPacket,markerPacket,markerKeys,compileProfile,readHeldBindings,readPulseBindings } from "../lib/bindings.ts";
import { makeProfile, makeRule, makeEvent } from "../lib/model.ts";
import { ConfigurationReader,mapFingerprint } from "../native/configuration.ts";
test("FD compiler addresses all banks, bounds macros, preserves modifiers and unique local markers",()=>{
  assert.ok(bindingPacket(1,1,{kind:"shortcut",keys:"Ctrl+C"}).startsWith("03FD01010100020000F10032060032"));
  assert.ok(bindingPacket(25,3,{kind:"shortcut",keys:"F24"}).startsWith("03FD19030101010000730032"));
  assert.equal(new Set(Array.from({length:75},(_,i)=>markerKeys(i).join(","))).size,75);
  assert.ok(markerPacket(3,2).startsWith("03FD03020100040000730032"));
  assert.throws(()=>bindingPacket(1,1,{kind:"macro",steps:Array.from({length:19},()=>({keys:"A",delay:50}))}));
  const profile=makeProfile("test","Test");profile.events=[];
  assert.equal(compileProfile(profile,"local").packets.length,75);
});

test("mixed routes held-key conditions and edge triggers over separate signals while preserving direct shortcuts", () => {
  const profile = makeProfile("held", "Ditar");
  const event = makeEvent("dictation", "Ditar");
  profile.events = [event];
  const controls = profile.layers[0]!.controls;
  controls[0]!.rules[0]!.behavior.action = { kind: "shortcut", keys: "Ctrl+C" };
  controls[1]!.rules[0]!.behavior.action = { kind: "text", value: "Windows" };
  const down = makeRule("down", "down");
  const release = makeRule("release", "release");
  down.behavior.transition = { eventId: event.id, operation: "set", stateId: "active" };
  release.behavior.transition = { eventId: event.id, operation: "set", stateId: "inactive" };
  controls[13]!.rules.push(down, release);
  event.states[1]!.condition = { id: "held", kind: "test", source: { kind: "key", controlId: "key-14" }, operator: "eq", value: true };

  for (const mode of ["mixed", "local"] as const) {
    const plan = compileProfile(profile, mode);
    assert.deepEqual(plan.errors, []);
    if (mode === "mixed") {
      assert.deepEqual(plan.windowsSlots, [1, 13]);
      assert.equal(plan.packets[0], bindingPacket(1, 1, { kind: "shortcut", keys: "Ctrl+C" }));
    }
    const entries = plan.packets.map((raw, index) => ({ raw, slot: index % 25 + 1, layer: Math.floor(index / 25) + 1 }));
    const [held, ...otherHeld] = readHeldBindings(entries);
    assert.equal(held?.index, 13);
    assert.deepEqual(otherHeld, []);
    const pulses = readPulseBindings(entries);
    assert.equal(pulses.size, mode === "mixed" ? 1 : 74);
    assert.ok([...pulses.keys()].every(code => !code.split(",").includes(String(held?.virtualKey))));
    if (mode === "mixed") assert.equal(plan.packets[1], markerPacket(2, 1));
  }
  assert.ok(compileProfile(profile, "device").errors.length);
  for (let index = 0; index < 4; index++) controls[index]!.rules.push(makeRule("held-" + index, "hold"));
  const fullPlan = compileProfile(profile, "local");
  const fullEntries = fullPlan.packets.map((raw, index) => ({ raw, slot: index % 25 + 1, layer: Math.floor(index / 25) + 1 }));
  assert.deepEqual(fullPlan.errors, []);
  assert.equal(new Set(readHeldBindings(fullEntries).map(binding => binding.virtualKey)).size, 5);
  assert.equal(readPulseBindings(fullEntries).size, 70);
  controls[4]!.rules.push(makeRule("one-too-many", "hold"));
  assert.match(compileProfile(profile, "mixed").errors.join(" "), /até 5 posições/);
});

test("mixed mode only reserves positions needing Windows, including all rules for the same press", () => {
  const profile = makeProfile("mixed", "Mixed");
  const controls = profile.layers[0]!.controls;
  controls[0]!.rules[0]!.behavior.action = { kind: "shortcut", keys: "Ctrl+C" };
  controls[1]!.rules[0]!.behavior.action = { kind: "text", value: "Olá" };
  controls[2]!.rules[0]!.behavior.action = { kind: "shortcut", keys: "A" };
  const double = makeRule("double", "double");
  double.behavior.action = { kind: "text", value: "Dois" };
  controls[2]!.rules.push(double);
  controls[3]!.rules[0]!.behavior.action = { kind: "shortcut", keys: "F24" };
  const plan = compileProfile(profile, "mixed");
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.windowsSlots, [1, 2, 3]);
  assert.deepEqual(plan.packets.slice(0, 5), [
    bindingPacket(1, 1, { kind: "shortcut", keys: "Ctrl+C" }),
    markerPacket(2, 1), markerPacket(3, 1), markerPacket(4, 1),
    bindingPacket(5, 1, { kind: "none" }),
  ]);
  controls[1]!.rules[0]!.behavior.action = { kind: "layer", value: 1 };
  assert.match(compileProfile(profile, "mixed").errors.join(" "), /Trocar camada/);
});
function fakeDevice(){
  const hex=(bytes:number[])=>Buffer.from(bytes).toString("hex").toUpperCase();
  const identity=new Array<number>(65).fill(0);identity.splice(0,5,3,251,16,3,11);
  const raw={at:Date.now(),devicePath:"test",identity:hex(identity),error:null,layers:[1,2,3].map(layer=>({layer,reports:Array.from({length:25},(_,i)=>bindingPacket(i+1,layer,{kind:"none"}).replace(/^03FD/,"03FA"))}))};
  return raw;
}
test("write transaction verifies all slots, rejects stale baseline and restores on partial failure",async()=>{
  const raw=fakeDevice();let writes=0,fail=false;
  const adapter={read:async()=>structuredClone(raw),write:async(packets:string[])=>{writes++;for(const p of packets){const slot=parseInt(p.slice(4,6),16),layer=parseInt(p.slice(6,8),16);raw.layers[layer-1]!.reports[slot-1]=p.replace(/^03FD/,"03FA");if(fail){fail=false;throw new Error("Disconnected after write");}}}};
  const reader=new ConfigurationReader(await mkdtemp(join(tmpdir(),"keymap-write-")),adapter);
  const before=await reader.read(),packet=bindingPacket(3,1,{kind:"shortcut",keys:"F24"});
  const applied=await reader.apply([packet],mapFingerprint(before));assert.equal(applied.changed,1);assert.equal(applied.map.entries[2]!.label,"F24");
  await assert.rejects(reader.apply([packet],mapFingerprint(before)),/mudou/);
  assert.equal(writes,1);
  fail=true;await assert.rejects(reader.apply([bindingPacket(3,1,{kind:"none"})]),/restaurada/);
  assert.equal((await reader.read()).entries[2]!.label,"F24");
});

test("media replaces a marker only after an exact NULL read and rolls back an interrupted conversion", async () => {
  const raw = fakeDevice();
  const slot = 25;
  const marker = markerPacket(slot, 1);
  const media = bindingPacket(slot, 1, { kind: "media", command: "volumeUp" });
  const clear = bindingPacket(slot, 1, { kind: "none" });
  const readBack = (packet: string) => packet.replace(/^03FD/, "03FA");
  raw.layers[0]!.reports[slot - 1] = readBack(marker);
  const operations: (string | string[])[] = [];
  let failMedia = true;
  const reader = new ConfigurationReader(await mkdtemp(join(tmpdir(), "keymap-media-transition-")), {
    read: async () => {
      operations.push("read");
      return structuredClone(raw);
    },
    write: async packets => {
      operations.push([...packets]);
      for (const packet of packets) {
        assert.equal(packet.slice(4, 8), marker.slice(4, 8));
        const previous = raw.layers[0]!.reports[slot - 1]!;
        if (packet === media && failMedia) throw new Error("Interrompido antes de gravar mídia");
        // Simulate firmware that keeps the tail of a prior binding when writing media.
        raw.layers[0]!.reports[slot - 1] = packet === media
          ? readBack(packet).slice(0, 20) + previous.slice(20)
          : readBack(packet);
      }
    },
  });
  try {
    await assert.rejects(reader.apply([media]), /original restaurada e relida/);
    assert.equal(raw.layers[0]!.reports[slot - 1], readBack(marker));
    assert.deepEqual(operations, ["read", [clear], "read", [media], "read", [marker], "read"]);
    operations.length = 0;
    failMedia = false;
    const result = await reader.apply([media]);
    assert.equal(result.changed, 1);
    assert.equal(result.map.entries[slot - 1]!.raw, readBack(media));
    assert.deepEqual(operations, ["read", [clear], "read", [media], "read"]);
  } finally {
    await reader.usb.close();
  }
});
