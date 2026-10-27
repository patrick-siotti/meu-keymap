import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChord, chordSelection, chordIdentity, KEY_OPTIONS, MODIFIER_OPTIONS, modifierVirtualKeys, parseChord } from "../lib/keys.ts";
import { bindingPacket, compileProfile, packetBytes } from "../lib/bindings.ts";
import { decodeHardwareAction } from "../lib/hardware-map.ts";
import { actionPresentation, controlPresentation, usesCustomLabel } from "../lib/action-presentation.ts";
import { CATALOG } from "../lib/catalog.ts";
import { makeProfile, makeRule, profileSchema } from "../lib/model.ts";
import { ProfileStore } from "../server.ts";

test("builder retains existing Windows/device codes, aliases, ordering and implicit plus Shift", () => {
  assert.deepEqual(parseChord("RightAlt+Ctrl+F24"), { modifiers: [247, 241], key: 115, virtualKey: 135 });
  assert.deepEqual(parseChord("control + meta + Escape"), { modifiers: [241, 244], key: 41, virtualKey: 27 });
  assert.deepEqual(chordSelection("control+META+escape"), { modifiers: ["Ctrl", "Win"], key: "Esc" });
  assert.equal(buildChord(["RightAlt", "Ctrl"], "F24"), "RightAlt+Ctrl+F24");
  assert.deepEqual(parseChord("Win++"), { modifiers: [244, 242], key: 46, virtualKey: 187 });
  assert.deepEqual(parseChord("RightShift++"), { modifiers: [246, 242], key: 46, virtualKey: 187 });
  assert.deepEqual(parseChord("Win+="), { modifiers: [244], key: 46, virtualKey: 187 });
  assert.deepEqual(modifierVirtualKeys, { 241: 162, 242: 160, 243: 164, 244: 91, 245: 163, 246: 161, 247: 165, 248: 92 });
  for (const invalid of ["Ctrl+Control+A", "Win+Meta+L", "Ctrl+NumLock", "F25", "Ç", "NumpadAdd", "Ctrl+", ""]) assert.throws(() => parseChord(invalid));
});

test("every selectable key and modifier combination survives device encoding and decoding", () => {
  assert.equal(new Set(KEY_OPTIONS.map(key => key.name)).size, KEY_OPTIONS.length);
  for (const key of KEY_OPTIONS) {
    for (const modifiers of [[], ...MODIFIER_OPTIONS.map(modifier => [modifier.name]), MODIFIER_OPTIONS.map(modifier => modifier.name)]) {
      const value = buildChord(modifiers, key.name), chord = parseChord(value);
      const selected = chordSelection(value);
      assert.equal(chordIdentity(buildChord(selected.modifiers, selected.key)), chordIdentity(value));
      const packet = bindingPacket(25, 3, { kind: "shortcut", keys: value }), bytes = packetBytes(packet);
      assert.deepEqual(bytes.slice(0, 5), [3, 253, 25, 3, 1]);
      assert.equal(bytes.length, 65);
      const action = decodeHardwareAction(bytes);
      assert.equal(action?.kind, "shortcut");
      if (action?.kind === "shortcut") assert.equal(chordIdentity(action.keys), chordIdentity(value));
      assert.equal(bytes[6], chord.modifiers.length + 1);
    }
  }
});

test("expanded catalog has valid chords, source/context and preserves established presentation", () => {
  assert.equal(new Set(CATALOG.map(item => item.id)).size, CATALOG.length);
  assert.ok(CATALOG.length > 90);
  for (const item of CATALOG) {
    if (item.action.kind !== "shortcut") continue;
    const keys = item.action.keys;
    assert.doesNotThrow(() => parseChord(keys), item.title);
    if (item.id.startsWith("windows-")) {
      assert.match(item.source ?? "", /^https:\/\/support\.microsoft\.com\//);
      assert.ok(item.context);
    }
  }
  for (const [keys, label, icon] of [["Ctrl+C", "Copiar", "copy"], ["Ctrl+V", "Colar", "paste"], ["Ctrl+X", "Recortar", "cut"], ["Win+Shift+S", "Captura de tela", "capture"]]) {
    assert.deepEqual(actionPresentation({ kind: "shortcut", keys: keys! }), { label, icon });
  }
  assert.equal(actionPresentation({ kind: "shortcut", keys: "Win+H" }).label, "Digitação por voz");
  const profile = makeProfile("names", "Nomes"), control = profile.layers[0]!.controls[0]!;
  control.label = "Downloads"; delete control.labelMode;
  control.rules[0]!.behavior.action = { kind: "shortcut", keys: "Win+H" };
  assert.ok(usesCustomLabel(control));
  assert.equal(controlPresentation(control, profile).label, "Downloads");
});

test("constructed actions save and reload with custom names/icons and compile in direct mode without markers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "keymap-shortcut-builder-")), store = new ProfileStore(directory);
  const original = await store.load(), profile = makeProfile("builder-save", "Builder QA");
  profile.events = [];
  for (const layer of profile.layers) for (const control of layer.controls) control.rules = [];
  const control = profile.layers[0]!.controls[0]!, rule = makeRule("qa-press", "press");
  rule.behavior.action = { kind: "shortcut", keys: buildChord(["Win"], "L") };
  control.rules = [rule]; control.label = "Minha trava"; control.labelMode = "custom"; control.icon = { kind: "library", name: "star" };
  const saved = await store.save({ ...original.document, activeProfile: profile.id, profiles: [profileSchema.parse(profile)] }, original.revision);
  const loaded = await store.load(), selected = loaded.document.profiles[0]!;
  assert.deepEqual(selected, profile);
  assert.equal(loaded.revision, saved.revision);
  assert.ok((await readFile(join(directory, "profiles.json"), "utf8")).includes("Minha trava"));
  const plan = compileProfile(selected, "device");
  assert.deepEqual(plan.errors, []); assert.equal(plan.packets.length, 75);
  assert.deepEqual(packetBytes(plan.packets[0]!).filter((_, index) => index === 9 || index === 12), [244, 15]);
  assert.equal(plan.packets.slice(1).every(packet => packetBytes(packet)[6] === 0), true);
  assert.equal(controlPresentation(selected.layers[0]!.controls[0]!, selected).customIcon?.kind, "library");
});

test("existing layer actions remain explicitly unsupported by direct hardware compilation", () => {
  const profile = makeProfile("layers", "Layers"); profile.events = [];
  for (const layer of profile.layers) for (const control of layer.controls) control.rules = [];
  const rule = makeRule("layer", "press"); rule.behavior.action = { kind: "layer", value: 1 };
  profile.layers[0]!.controls[0]!.rules = [rule];
  assert.throws(() => bindingPacket(1, 1, rule.behavior.action), /Automações/);
  assert.ok(compileProfile(profile, "device").errors.some(error => error.includes("Automações")));
  assert.match(CATALOG.find(item => item.id === "layer-1")!.description, /Não muda a camada física/);
});
