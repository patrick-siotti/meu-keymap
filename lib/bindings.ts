import { conditionSources,conditionCount } from "./conditions.ts";
import { HARDWARE_CHANNELS } from "./hardware-map.ts";
import { modifierVirtualKeys, parseChord } from "./keys.ts";
import { EVENT_LABELS, controlName } from "./model.ts";
import type { Action, Behavior, Profile, Rule } from "./model.ts";
import { OBS_KEYS } from "./obs.ts";
export const APPLICATION_MODES = ["device", "mixed", "local"] as const;
export type ApplicationMode = (typeof APPLICATION_MODES)[number];
export const APPLICATION_MODE_LABELS: Record<ApplicationMode, string> = {
  device: "Direto no aparelho",
  mixed: "Misto",
  local: "Automações no Windows",
};
export function isApplicationMode(value: unknown): value is ApplicationMode {
  return APPLICATION_MODES.some(mode => mode === value);
}
export interface BindingPlan {
  mode: ApplicationMode;
  packets: string[];
  windowsSlots: number[];
  errors: string[];
  warnings: string[];
}
export const packetHex=(bytes:number[])=>bytes.map(b=>b.toString(16).padStart(2,"0")).join("").toUpperCase();
export const packetBytes=(hex:string)=>hex.match(/../g)!.map(b=>parseInt(b,16));
export function bindingPacket(slot:number,layer:number,action:Action):string {
  const b=new Array<number>(65).fill(0);b.splice(0,5,3,253,slot,layer,1);
  if(slot<1||slot>25||layer<1||layer>3)throw new Error("Endereço inválido.");
  if(action.kind==="none")return packetHex(b);
  if(action.kind==="media"){
    b[4]=2;b[6]=2;b[9]=({volumeUp:233,volumeDown:234,mute:226,playPause:205,next:181,previous:182})[action.command];return packetHex(b);
  }
  if(action.kind!=="shortcut"&&action.kind!=="macro")throw new Error("Esta ação precisa do modo Automações.");
  const steps=action.kind==="shortcut"?[{keys:action.keys,delay:50}]:action.steps;
  const entries:{code:number;delay:number}[]=[];
  for(const step of steps){const chord=parseChord(step.keys);for(const code of chord.modifiers)entries.push({code,delay:50});entries.push({code:chord.key,delay:step.delay});}
  if(entries.length>18)throw new Error("O aparelho aceita no máximo 18 entradas por macro, contando modificadores.");
  // Modifier codes use the triplet format even when they are the only entry.
  const singleKey = action.kind === "shortcut" && entries.length === 1 && !modifierVirtualKeys[entries[0]!.code];
  b[5] = singleKey ? 1 : 0;
  b[6] = entries.length;
  entries.forEach((e,i)=>{b[9+3*i]=e.code;b[10+3*i]=e.delay>>8;b[11+3*i]=e.delay&255;});
  return packetHex(b);
}
export const MARKERS:number[][]=[];
for(let a=0;a<9;a++)for(let b=a+1;b<10;b++)for(let c=b+1;c<11;c++)MARKERS.push([115,104+a,104+b,104+c]);
export function markerKeys(index:number):number[]{if(!Number.isInteger(index)||index<0||index>=75)throw new Error("Marcador inválido.");return [...MARKERS[index]!];}
export function markerPacket(slot:number,layer:number,keys:readonly number[]=markerKeys((layer-1)*25+slot-1)):string {
  const b=packetBytes(bindingPacket(slot,layer,{kind:"none"}));b[6]=4;
  keys.forEach((key,i)=>{b[9+i*3]=key;b[11+i*3]=50;});return packetHex(b);
}
// Leave F24 as the pulse prefix and at least six other usages for ordered triples.
const HELD_USAGES = [114, 113, 112, 111, 110]; // F23 through F19
function pulseKeysWithout(reserved: readonly number[]): readonly number[][] {
  if (!reserved.length) return MARKERS;
  const result = MARKERS.slice(0, 75).map(keys => keys.some(key => reserved.includes(key)) ? null : keys);
  const free = Array.from({ length: 11 }, (_, index) => 104 + index).filter(key => !reserved.includes(key));
  const combinations = (function* () {
    yield* MARKERS.slice(75).filter(keys => keys.every(key => !reserved.includes(key)));
    for (const first of free) for (const second of free) for (const third of free)
      if (first !== second && first !== third && second !== third && !(first < second && second < third))
        yield [115, first, second, third];
  })();
  return result.map(keys => keys ?? combinations.next().value!);
}
export interface HeldBinding { index: number; virtualKey: number; }
function heldMarkerPacket(index: number, usage: number): string {
  return bindingPacket(index % 25 + 1, Math.floor(index / 25) + 1, { kind: "shortcut", keys: "F" + (usage - 91) });
}
export function readHeldBindings(entries: readonly { slot: number; layer: number; raw: string }[]): HeldBinding[] {
  return entries.flatMap(({ slot, layer, raw }) => {
    const virtualKey = slot > 16 ? null : heldVirtualKey(raw);
    return virtualKey === null ? [] : [{ index: (layer - 1) * 25 + slot - 1, virtualKey }];
  });
}
export function heldVirtualKey(raw: string): number | null {
  if (raw.slice(8, 14) !== "010101") return null;
  const usage = parseInt(raw.slice(18, 20), 16);
  return HELD_USAGES.includes(usage) ? usage + 20 : null;
}
export function readPulseBindings(entries: readonly { slot: number; layer: number; raw: string }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const { slot, layer, raw } of entries) {
    const bytes = packetBytes(raw);
    if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 4 || bytes[9] !== 115) continue;
    const keys = Array.from({ length: 4 }, (_, index) => bytes[9 + index * 3]! + 20);
    if (keys.slice(1).some(key => key < 124 || key > 134)) continue;
    result.set(keys.join(","), (layer - 1) * 25 + slot - 1);
  }
  return result;
}
const needsKeyEdges = (trigger: Rule["trigger"]) => trigger === "down" || trigger === "hold" || trigger === "release";
function requiresWindows(rule: Rule): boolean {
  return !["press", "left", "right"].includes(rule.trigger)
    || !!rule.qualifier.controlId || rule.qualifier.modifiers.length > 0
    || conditionCount(rule.condition) > 0 || !!rule.behavior.when.eventId
    || !!rule.behavior.transition.eventId || !!rule.otherwise;
}

function hasAction(behavior: Behavior): boolean {
  return behavior.action.kind !== "none" || !!behavior.transition.eventId;
}

function usesMarkerKeys(packet: string): boolean {
  const bytes = packetBytes(packet);
  if (bytes[4] !== 1) return false;
  return Array.from({ length: bytes[6]! }, (_, index) => bytes[9 + index * 3]!)
    .some(code => code >= 104 && code <= 115);
}

export function compileProfile(profile:Profile,mode:ApplicationMode):BindingPlan {
  const errors:string[]=[],warnings=new Set<string>(),packets:string[]=[];
  // Positions use the same zero-based layer/slot order as the marker decoder.
  const windowsSlots: number[] = [];
  const heldSlots = new Set<number>();
  const trackKey = (id: string, layer: number, where: string) => {
    const channel = HARDWARE_CHANNELS.find(value => value.controlId === id && value.trigger === "press" && value.slot <= 16);
    if (!channel) {
      errors.push(where + ": use uma das 16 teclas para acompanhar se está pressionada.");
      return;
    }
    heldSlots.add(layer * 25 + channel.slot - 1);
  };
  const checkSources = (sources: ReturnType<typeof conditionSources>, where: string, layer: number | null) => {
    for (const source of sources) {
      if (source.kind === "key" && mode !== "device" && layer !== null) trackKey(source.controlId, layer, where);
      if (source.kind === "input" && source.provider !== "windows" && !(source.provider === "obs" && OBS_KEYS.some(key => key === source.key)))
        warnings.add("Fonte " + source.label + " sem adaptador: valor desconhecido, seguirá Senão.");
    }
  };
  const eventLayers = new Map(profile.events.map(event => [event.id, new Set<number>()]));
  for (const event of profile.events) for (const state of event.states)
    checkSources(conditionSources(state.condition), event.name, null);
  for (const [layer, bank] of profile.layers.entries()) for (const control of bank.controls) for (const rule of control.rules) {
    if (mode === "device") continue;
    const where = "Camada " + (layer + 1) + ", " + controlName(control, profile);
    if (needsKeyEdges(rule.trigger)) trackKey(control.id, layer, where);
    if (rule.qualifier.controlId) trackKey(rule.qualifier.controlId, layer, where);
    checkSources(conditionSources(rule.condition), where, layer);
    eventLayers.get(rule.behavior.transition.eventId)?.add(layer);
    if (rule.otherwise) eventLayers.get(rule.otherwise.transition.eventId)?.add(layer);
  }
  if (mode !== "device") for (const event of profile.events) {
    const layers = eventLayers.get(event.id)!;
    for (const state of event.states) for (const source of conditionSources(state.condition)) {
      if (source.kind === "key")
        for (const layer of layers.size ? layers : [0]) trackKey(source.controlId, layer, event.name);
    }
  }
  const addWindowsSlot = (slot: number, layer: number) => {
    windowsSlots.push(packets.length);
    packets.push(markerPacket(slot, layer));
  };
  const mixedLayerError = "Trocar camada por ação ou executar ao ativar a camada exige Automações no Windows para o perfil inteiro.";
  const rgbWarning="O perfil tem efeitos de luz antigos. Para ajustar as cores do aparelho, use a aba LEDs.";
  if(profile.events.some(e=>e.states.some(s=>s.lights.length||s.otherwise?.lights.length)))warnings.add(rgbWarning);
  if(mode==="device"&&profile.events.length)errors.push("Eventos personalizados precisam do modo Misto ou Automações no Windows.");
  profile.layers.forEach((layer,index)=>{
    for(const control of layer.controls){
      const where=`Camada ${index+1}, ${control.id}`;
      for(const rule of control.rules){
        if(rule.behavior.light.effect.mode!=="none"||rule.otherwise?.light.effect.mode&&rule.otherwise.light.effect.mode!=="none")warnings.add(rgbWarning);
        if(mode==="device"){
          if(rule.trigger==="activate"&&rule.behavior.action.kind==="none"&&!rule.behavior.transition.eventId)continue;
          if(requiresWindows(rule))errors.push(`${where}: o gatilho ${EVENT_LABELS[rule.trigger]} precisa do modo Misto ou Automações no Windows.`);
        }else{
          if (mode === "mixed" && rule.trigger === "activate" && (hasAction(rule.behavior) || rule.otherwise && hasAction(rule.otherwise))) errors.push(mixedLayerError);
        }
        for(const behavior of [rule.behavior,...(rule.otherwise?[rule.otherwise]:[])]){
          if (mode === "mixed" && behavior.action.kind === "layer") errors.push(mixedLayerError);
          if (behavior.action.kind === "shortcut" && behavior.action.whileHeld && (control.kind !== "key" || rule.trigger !== "down"))
            errors.push(`${where}: para manter o atalho pressionado, use o gatilho Pressionar de uma tecla.`);
          if(behavior.action.kind==="shortcut")try{parseChord(behavior.action.keys);}catch(e){errors.push(`${where}: ${(e as Error).message}`);}
          if(behavior.action.kind==="macro")for(const step of behavior.action.steps)try{parseChord(step.keys);}catch(e){errors.push(`${where}: ${(e as Error).message}`);}
        }
      }
    }
    for(const channel of HARDWARE_CHANNELS){
      const control=layer.controls.find(c=>c.id===channel.controlId)!;
      const rules=control.rules.filter(r=>r.trigger===channel.trigger&&!r.qualifier.controlId&&!r.qualifier.modifiers.length);
      if (heldSlots.has(packets.length)) {
        addWindowsSlot(channel.slot, index + 1);
        continue;
      }
      if (mode === "local") {
        addWindowsSlot(channel.slot, index + 1);
        continue;
      }
      if (mode === "mixed") {
        const channelRules = control.rules.filter(rule => rule.trigger === channel.trigger
          || (channel.trigger === "press" && rule.trigger === "double"));
        if (channelRules.length > 1 || channelRules.some(requiresWindows)) {
          addWindowsSlot(channel.slot, index + 1);
          continue;
        }
      }
      try {
        if (rules.length > 1) throw new Error("Mais de uma regra para a mesma posição.");
        packets.push(bindingPacket(channel.slot, index + 1, rules[0]?.behavior.action ?? { kind: "none" }));
      } catch (error) {
        if (mode === "mixed") addWindowsSlot(channel.slot, index + 1);
        else errors.push(`Camada ${index + 1}, código ${channel.slot}: ${(error as Error).message}`);
      }
    }
  });
  for(const event of profile.events)for(const state of event.states){
    for(const action of [state.action,...(state.otherwise?[state.otherwise.action]:[])]){
      if (mode === "mixed" && action.kind === "layer") errors.push(mixedLayerError);
      if (action.kind === "shortcut" && action.whileHeld)
        errors.push(`${event.name}: para manter o atalho pressionado, use o gatilho Pressionar de uma tecla.`);
      if(action.kind==="shortcut")try{parseChord(action.keys);}catch(e){errors.push((e as Error).message);}
      if(action.kind==="macro")for(const step of action.steps)try{parseChord(step.keys);}catch(e){errors.push((e as Error).message);}
    }
  }
  if (mode === "mixed" && windowsSlots.length) {
    // A direct shortcut using the reserved keys can interfere with a marker.
    for (const [index, packet] of packets.entries()) {
      if (windowsSlots.includes(index) || !usesMarkerKeys(packet)) continue;
      packets[index] = markerPacket(index % 25 + 1, Math.floor(index / 25) + 1);
      windowsSlots.push(index);
    }
    windowsSlots.sort((a, b) => a - b);
    warnings.add("As automações rodam no Windows e reservam F13–F24. Evite usar essas teclas como atalhos em outros programas.");
  }
  if (heldSlots.size > HELD_USAGES.length) {
    errors.push("Use Pressionar, Segurar, Soltar e Tecla pressionada em até 5 posições somadas nas três camadas.");
  } else if (heldSlots.size) {
    const pulseSlots = windowsSlots.filter(index => !heldSlots.has(index));
    const counts = new Map(HELD_USAGES.map(usage =>
      [usage, pulseSlots.filter(index => MARKERS[index]!.includes(usage)).length] as const));
    const usages = [...counts].sort((left, right) => left[1] - right[1])
      .slice(0, heldSlots.size).map(([usage]) => usage);
    const pulseKeys = pulseKeysWithout(usages);
    for (const index of pulseSlots)
      packets[index] = markerPacket(index % 25 + 1, Math.floor(index / 25) + 1, pulseKeys[index]);
    for (const [position, index] of [...heldSlots].sort((a, b) => a - b).entries())
      packets[index] = heldMarkerPacket(index, usages[position]!);
  }
  if(mode==="local")warnings.add("Requer o servidor local ativo. Reserva F13–F24; evite atribuir essas teclas em outros programas. A camada física só é reconhecida no próximo toque.");
  return {mode,packets,windowsSlots,errors:[...new Set(errors)],warnings:[...warnings]};
}
