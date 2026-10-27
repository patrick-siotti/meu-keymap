import { useEffect, useRef, useState } from "react";
import { X, CircleAlert } from "lucide-react";
import {
  defaultDocument,
  documentSchema,
  parseDocument,
  makeProfile,
  emptyBehavior,
} from "../lib/model";
import type {
  Action,
  Behavior,
  Control,
  KeymapDocument,
  Profile,
  Rule,
  Trigger,
} from "../lib/model";
import {
  freshRuntime,
  startRuntime,
  activateLayer,
  simulate,
  simulateRule,
  changeEvent,
  previewEventState,
} from "../lib/engine";
import {
  downloadProfiles,
  loadProfiles,
  saveProfiles,
  syncProfiles,
} from "./services/profiles";
import { usePreviewClock } from "./hooks/usePreviewClock";
import { useSignalMonitor } from "./hooks/useSignalMonitor";
import { AppHeader } from "./components/AppHeader";
import { Configurator } from "./components/Configurator";
import { EventsScreen } from "./components/EventsScreen";
import { ActionLibrary } from "./components/ActionLibrary";
import { ProfileDialog } from "./components/ProfileDialog";
import { RuleDialog } from "./components/RuleDialog";
import { Capabilities } from "./components/Capabilities";
import { Modal } from "./components/Modal";
import { DeleteProfileDialog } from "./components/DeleteProfileDialog";
import { removeProfile } from "../lib/profiles";
import { DeviceDialog } from "./components/DeviceDialog";
import { CalibrationDialog } from "./components/CalibrationDialog";
import { HardwareMapDialog } from "./components/HardwareMapDialog";
import { profileFromHardware } from "../lib/hardware-map";
import { ApplyProfileDialog } from "./components/ApplyProfileDialog";
import { ExecutionDialog } from "./components/ExecutionDialog";
import { useApplicationState } from "./hooks/useApplicationState";
import { usesCustomLabel } from "../lib/action-presentation";
import { resolveEditorRule,editControlRule } from "../lib/editor-rule";
import type { ApplicationMode } from "../lib/bindings";
import { startExecution } from "./services/application";
import { LedsScreen } from "./components/LedsScreen";
import { VerificationDialog } from "./components/VerificationDialog";
type LibraryTarget =
  | { kind: "rule"; custom: boolean; branch: "then" | "else" }
  | {
      kind: "state";
      eventId: string;
      stateId: string;
      custom: boolean;
      branch: "then" | "else";
    };
export function App() {
  const [document, setDocument] = useState<KeymapDocument>(defaultDocument),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState(""),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [applicationFeedback,setApplicationFeedback]=useState("");
  const [selected, setSelected] = useState("key-6"),
    [selectedTrigger,setSelectedTrigger]=useState<Trigger>("press"),
    [ruleId, setRuleId] = useState(""),
    [runtime, setRuntime] = useState(freshRuntime),
    [testing, setTesting] = useState(false),
    [screen, setScreen] = useState<"keys" | "events" | "leds">("keys");
  const [library, setLibrary] = useState<LibraryTarget | null>(null),
    [addingRule, setAddingRule] = useState(false),
    [profileDialog, setProfileDialog] = useState<
      false | "new" | "rename" | "duplicate"
    >(false),
    [help, setHelp] = useState(false),
    [pendingImport, setPendingImport] = useState<KeymapDocument | null>(null);
  const [deletingProfileId, setDeletingProfileId] = useState("");
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [ledsDirty,setLedsDirty]=useState(false);
  const [verificationOpen,setVerificationOpen]=useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [hardwareMapOpen, setHardwareMapOpen] = useState(false);
  const [applyOpen,setApplyOpen]=useState(false),[executionOpen,setExecutionOpen]=useState(false);
  const [modeChoices,setModeChoices]=useState<Record<string,ApplicationMode>>({});
  const [starting,setStarting]=useState(false);
  const fileInput = useRef<HTMLInputElement>(null),
    now = usePreviewClock(runtime);
  const [live, setLive] = useState(false);
  const monitor = useSignalMonitor(live);
  useEffect(() => {
    setRuntime((r) => ({ ...r, observed: monitor.sample }));
  }, [monitor.sample]);
  const dirty = saved !== JSON.stringify(document),
    profile = document.profiles.find((p) => p.id === document.activeProfile)!,
    layer = runtime.layer,
    control = profile.layers[layer]!.controls.find((c) => c.id === selected)!;
  const selection=resolveEditorRule(control,ruleId,selectedTrigger),rule=selection.rule;
  const application=useApplicationState(profile);
  const mode=modeChoices[profile.id]??(application.status?.deployment?.profileId===profile.id?application.status.deployment.mode:"local");
  const setMode=(value:ApplicationMode)=>setModeChoices(current=>({...current,[profile.id]:value}));
  useEffect(()=>{if(dirty)setApplicationFeedback("");},[dirty]);
  const libraryState =
    library?.kind === "state"
      ? profile.events
          .find((e) => e.id === library.eventId)
          ?.states.find((s) => s.id === library.stateId)
      : null;
  const libraryAction: Action =
    library?.kind === "state"
      ? ((library.branch === "else"
          ? libraryState?.otherwise?.action
          : libraryState?.action) ?? { kind: "none" })
      : ((library?.branch === "else"
          ? rule?.otherwise?.action
          : rule?.behavior.action) ?? { kind: "none" });
  useEffect(() => {
    const controller = new AbortController();
    loadProfiles(controller.signal)
      .then((data) => {
        setDocument(data.document);
        setSaved(JSON.stringify(data.document));
        setRevision(data.revision);
        setRuntime(
          startRuntime(
            data.document.profiles.find(
              (p) => p.id === data.document.activeProfile,
            )!,
          ),
        );
        setLoading(false);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setLoadError((e as Error).message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!dirty || loading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, loading]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  function updateProfile(next: Profile) {
    setDocument((doc) => ({
      ...doc,
      profiles: doc.profiles.map((p) => (p.id === next.id ? next : p)),
    }));
    if (profile.events.some((e) => !next.events.some((n) => n.id === e.id)))
      setRuntime(startRuntime(next));
  }
  function updateControl(patch: Partial<Control>) {
    setDocument((doc) => {
      const next = structuredClone(doc),
        p = next.profiles.find((p) => p.id === next.activeProfile)!,
        index = p.layers[layer]!.controls.findIndex((c) => c.id === selected);
      p.layers[layer]!.controls[index] = {
        ...p.layers[layer]!.controls[index]!,
        ...patch,
      };
      return next;
    });
  }
  function updateBehavior(
    patch: Partial<Behavior>,
    branch: "then" | "else" = "then",
  ) {
    changeRule(r=>({...r,[branch==="else"?"otherwise":"behavior"]:{...(branch==="else"?(r.otherwise??emptyBehavior()):r.behavior),...patch}}));
  }
  function changeRule(edit:(rule:Rule)=>Rule,patch:Partial<Control>={}){
    if(!rule)return;
    try{updateControl({...patch,rules:editControlRule(control,selection,edit)});setRuleId(rule.id);}
    catch(e){setError((e as Error).message);}
  }
  function select(id: string, trigger: Trigger) {
    setSelected(id);
    setSelectedTrigger(trigger);
    const c = profile.layers[layer]!.controls.find((c) => c.id === id)!;
    setRuleId(
      c.rules.find(
        (r) =>
          r.trigger === trigger &&
          !r.qualifier.controlId &&
          !r.qualifier.modifiers.length,
      )?.id ?? "",
    );
    if (testing)
      setRuntime((current) => simulate(profile, current, layer, id, trigger));
  }
  async function save(apply=true) {
    const parsed = documentSchema.safeParse(document);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ??
          "Confira nomes e configurações antes de salvar.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    setApplicationFeedback("");
    const snapshot = document;
    try {
      const sync=apply?await syncProfiles(parsed.data,revision,mode):null;
      const result=sync?sync.saved:await saveProfiles(parsed.data,revision);
      setRevision(result.revision);
      setSaved(JSON.stringify(snapshot));
      if(sync&&!sync.applied)setError(sync.error??"Salvo, mas não aplicado no aparelho.");
      else if(apply)setApplicationFeedback(sync?.mode==="local"?"Perfil aplicado.":"Atalhos aplicados e conferidos.");
      else setNotice("Alterações guardadas.");
      await application.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function startApplied(){
    setStarting(true);setError("");
    try{await startExecution();await application.refresh();setNotice("Motor iniciado para o perfil aplicado.");}
    catch(e){setError((e as Error).message);}finally{setStarting(false);}
  }
  function chooseAction(action: Action, label: string,customName=false) {
    if (library?.kind === "state") {
      const target = library;
      updateProfile({
        ...profile,
        events: profile.events.map((e) =>
          e.id === target.eventId
            ? {
                ...e,
                states: e.states.map((s) =>
                  s.id === target.stateId
                    ? target.branch === "else"
                      ? {
                          ...s,
                          otherwise: {
                            ...(s.otherwise ?? {
                              action: { kind: "none" as const },
                              lights: [],
                            }),
                            action,
                          },
                        }
                      : { ...s, action }
                    : s,
                ),
              }
            : e,
        ),
      });
    } else if (rule) {
      changeRule(r=>library?.branch==="else"?{...r,otherwise:{...(r.otherwise??emptyBehavior()),action}}:{...r,behavior:{...r.behavior,action}},{
        ...(library?.branch!=="else"&&rule.trigger==="press"&&customName?{label:label.slice(0,30),labelMode:label?"custom" as const:"auto" as const}:{}),
      });
    }
    setLibrary(null);
  }
  function modifyProfile(name: string) {
    if (profileDialog === "rename") updateProfile({ ...profile, name });
    else {
      const id = crypto.randomUUID();
      const added =
        profileDialog === "duplicate"
          ? { ...structuredClone(profile), id, name }
          : { ...makeProfile(id, name), events: [] };
      setDocument((doc) => ({
        ...doc,
        profiles: [...doc.profiles, added],
        activeProfile: id,
      }));
      setRuntime(startRuntime(added));
      setRuleId("");setSelectedTrigger("press");
    }
    setProfileDialog(false);
  }
  function deleteProfile() {
    const next = removeProfile(document, deletingProfileId);
    if (next !== document) {
      setDocument(next);
      if (next.activeProfile !== document.activeProfile) {
        setRuntime(
          startRuntime(next.profiles.find((p) => p.id === next.activeProfile)!),
        );
        setRuleId("");setSelectedTrigger("press");
      }
      setNotice("Perfil removido do rascunho.");
    }
    setDeletingProfileId("");
  }
  async function readImport(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 2_000_000)
        throw new Error("O arquivo deve ter no máximo 2 MB.");
      setPendingImport(parseDocument(JSON.parse(await file.text())));
    } catch(e) {
      setError(e instanceof Error?`Não foi possível importar: ${e.message}`:"Arquivo inválido ou incompatível com o meu keymap.");
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  function addRule(next: Rule) {
    updateControl({ rules: [...control.rules, next] });
    setRuleId(next.id);
    setSelectedTrigger(next.trigger);
    setAddingRule(false);
  }
  if (loading)
    return (
      <div
        className="loading-shell"
        aria-busy="true"
        aria-label="Carregando configurador"
      >
        <div className="skeleton skeleton-header" />
        <div className="skeleton-workspace">
          <div className="skeleton skeleton-board" />
          <div className="skeleton skeleton-editor" />
        </div>
      </div>
    );
  if (loadError)
    return (
      <main className="load-error">
        <CircleAlert size={32} />
        <h1>Não foi possível abrir seu keymap</h1>
        <p>{loadError}</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </main>
    );
  return (
    <>
      <AppHeader
        document={document}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onSaveOnly={()=>void save(false)}
        applied={application.applied&&mode===application.status?.deployment?.mode}
        applicationLabel={application.applied&&mode!==application.status?.deployment?.mode?"Modo alterado · aplicar novamente":application.label}
        mode={mode}
        onMode={setMode}
        onSelect={(id) => {
          const next = document.profiles.find((p) => p.id === id)!;
          setDocument((d) => ({ ...d, activeProfile: id }));
          setRuntime(startRuntime(next));
          setRuleId("");
          setSelectedTrigger("press");
        }}
        onProfile={setProfileDialog}
        onDeleteProfile={() => setDeletingProfileId(document.activeProfile)}
        onExport={() => downloadProfiles(document)}
        onImport={() => fileInput.current?.click()}
        onHelp={() => setHelp(true)}
        onDevice={() => setDeviceOpen(true)}
        onApply={()=>setApplyOpen(true)}
        onExecution={()=>setExecutionOpen(true)}
        screen={screen}
        onScreen={next=>{if(screen!=="leds"||!ledsDirty||window.confirm("Há um rascunho de LEDs não gravado. Continuar? Ele será mantido nesta janela."))setScreen(next);}}
      />
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="application/json,.json"
        onChange={(e) => void readImport(e.target.files?.[0])}
      />
      {error && (
        <div role="alert" className="error-banner">
          <CircleAlert size={17} />
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Fechar erro"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {applicationFeedback&&<div className="application-feedback" role="status"><span>{applicationFeedback}</span><button className="icon-button" aria-label="Fechar confirmação de aplicação" onClick={()=>setApplicationFeedback("")}><X size={16}/></button></div>}
      {application.status?.deployment?.mode==="local"&&!application.status.runtime.active&&<div className="runtime-notice" role="status"><span>Automações paradas.</span><button className="button" disabled={starting||saving||application.status.busy} onClick={()=>void startApplied()}>{starting?"Iniciando…":"Iniciar automações"}</button></div>}
      {screen === "keys" ? (
        <Configurator
          live={live}
          status={monitor.status}
          onLive={(value) => {
            setRuntime((r) => ({ ...r, signals: {}, observed: null }));
            setLive(value);
          }}
          onValue={(key, value) =>
            setRuntime((r) => ({
              ...r,
              signals: { ...r.signals, [key]: value },
            }))
          }
          profile={profile}
          runtime={runtime}
          selected={selected}
          trigger={rule?.trigger ?? selectedTrigger}
          now={now}
          testing={testing}
          onTesting={setTesting}
          onSelect={select}
          onLayer={(index) =>{setRuleId("");setRuntime((r) => activateLayer(profile, r, index));}}
          onState={(eventId, stateId) =>
            setRuntime((r) => changeEvent(profile, r, eventId, stateId))
          }
          onReset={() =>
            setRuntime(activateLayer(profile, startRuntime(profile), layer))
          }
          inspector={{
            control,
            mode,
            profile,
            layer,
            rule,
            virtual:selection.virtual,
            onRule: id=>{setRuleId(id);const chosen=control.rules.find(r=>r.id===id);setSelectedTrigger(chosen?.trigger??"press");},
            onAdd: () => setAddingRule(true),
            onRemove: () => {
              if (rule&&!selection.virtual){
                updateControl({
                  rules: control.rules.filter((r) => r.id !== rule.id),
                });
                setRuleId("");
              }
            },
            onControl: updateControl,
            onBehavior: updateBehavior,
            onCondition: condition=>changeRule(r=>({...r,condition})),
            onLibrary: (custom, branch = "then") =>
              setLibrary({ kind: "rule", custom: !!custom, branch }),
            onTest: () => {
              if (rule&&!selection.virtual) {
                setRuntime((r) =>
                  simulateRule(profile, r, layer, selected, rule),
                );
                setTesting(true);
              }
            },
            onManageEvents: () => setScreen("events"),
          }}
        />
      ) : screen === "events" ? (
        <EventsScreen
          key={profile.id}
          profile={profile}
          runtime={runtime}
          onChange={updateProfile}
          onPreview={(eventId, stateId) =>
            setRuntime((r) => previewEventState(profile, r, eventId, stateId))
          }
          onAction={(eventId, stateId, branch) =>
            setLibrary({
              kind: "state",
              eventId,
              stateId,
              custom: false,
              branch,
            })
          }
        />
      ) : null}
      <LedsScreen active={screen==="leds"} onDirty={setLedsDirty}/>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {library && (
        <ActionLibrary
          current={libraryAction}
          mode={mode}
          custom={library.custom}
          showLabel={library.kind === "rule" && library.branch==="then" && rule?.trigger==="press"}
          initialLabel={library.kind==="rule"&&usesCustomLabel(control)?control.label:""}
          onSelect={chooseAction}
          onClose={() => setLibrary(null)}
        />
      )}
      {addingRule && (
        <RuleDialog
          control={control}
          profile={profile}
          layer={layer}
          onClose={() => setAddingRule(false)}
          onAdd={addRule}
        />
      )}
      {profileDialog && (
        <ProfileDialog
          mode={profileDialog}
          initial={profile.name}
          onClose={() => setProfileDialog(false)}
          onSubmit={modifyProfile}
        />
      )}
      {deletingProfileId && (
        <DeleteProfileDialog
          name={
            document.profiles.find((p) => p.id === deletingProfileId)?.name ??
            ""
          }
          onClose={() => setDeletingProfileId("")}
          onConfirm={deleteProfile}
        />
      )}
      {help && <Capabilities onClose={() => setHelp(false)} />}
      {applyOpen&&<ApplyProfileDialog profile={profile} mode={mode} onMode={setMode} onClose={()=>setApplyOpen(false)} onApplied={()=>{setApplyOpen(false);setExecutionOpen(true);void application.refresh();setNotice(mode==="local"?"Perfil aplicado · motor ativo.":"Atalhos aplicados e conferidos no aparelho.");}}/>}
      {executionOpen&&<ExecutionDialog onClose={()=>setExecutionOpen(false)}/>}
      {verificationOpen&&<VerificationDialog onClose={()=>setVerificationOpen(false)}/>}
      {deviceOpen && (
        <DeviceDialog
          onClose={() => setDeviceOpen(false)}
          onRgb={()=>{setDeviceOpen(false);setScreen("leds");}}
          onVerify={()=>{setDeviceOpen(false);setVerificationOpen(true);}}
          onMap={() => {
            setDeviceOpen(false);
            setHardwareMapOpen(true);
          }}
          onIdentify={() => {
            setDeviceOpen(false);
            setCalibrationOpen(true);
          }}
        />
      )}
      {calibrationOpen && (
        <CalibrationDialog onClose={() => setCalibrationOpen(false)} />
      )}
      {hardwareMapOpen && (
        <HardwareMapDialog
          onClose={() => setHardwareMapOpen(false)}
          canImport={document.profiles.length < 20}
          onConfigure={(controlId, trigger, targetLayer) => {
            const target = profile.layers[targetLayer]!.controls.find(c => c.id === controlId)!;
            setSelected(controlId);
            setSelectedTrigger(trigger);
            setRuleId(target.rules.find(r => r.trigger === trigger && !r.qualifier.controlId && !r.qualifier.modifiers.length)?.id ?? "");
            setScreen("keys");
            setTesting(false);
            setRuntime(r => activateLayer(profile, r, targetLayer));
            setHardwareMapOpen(false);
          }}
          onImport={map => {
            if (document.profiles.length >= 20) return;
            let name = "Do macropad", suffix = 2;
            while (document.profiles.some(p => p.name === name)) name = `Do macropad ${suffix++}`;
            const added = profileFromHardware(map, crypto.randomUUID(), name);
            setDocument(doc => ({...doc, profiles: [...doc.profiles, added], activeProfile: added.id}));
            setRuntime(startRuntime(added));
            setSelected("key-1");
            setRuleId("");setSelectedTrigger("press");
            setScreen("keys");
            setTesting(false);
            setHardwareMapOpen(false);
            setNotice("Perfil criado com as ações lidas. Salve no computador para guardá-lo.");
          }}
        />
      )}
      {pendingImport && (
        <Modal
          title="Importar configurações?"
          subtitle={`${pendingImport.profiles.length} perfil(is).`}
          onClose={() => setPendingImport(null)}
        >
          <div className="import-confirm">
            <p>
              O arquivo substituirá o rascunho aberto.
            </p>
            <div className="form-footer">
              <button
                className="button"
                onClick={() => downloadProfiles(document)}
              >
                Exportar rascunho atual
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const next = pendingImport;
                  setDocument(next);
                  setRuleId("");setSelectedTrigger("press");
                  setRuntime(
                    startRuntime(
                      next.profiles.find((p) => p.id === next.activeProfile)!,
                    ),
                  );
                  setPendingImport(null);
                  setNotice("Configurações importadas para o rascunho.");
                }}
              >
                Importar para o rascunho
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
