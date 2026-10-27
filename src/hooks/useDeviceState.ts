import { useEffect, useState } from "react";
import type { DeviceStateSnapshot } from "../../lib/device-state";
import { loadDeviceState } from "../services/device-state";
export function useDeviceState(){
  const [state,setState]=useState<DeviceStateSnapshot|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
    async function refresh(){try{const value=await loadDeviceState(controller.signal);if(!controller.signal.aborted){setState(value);setError("");}}catch(error){if(!controller.signal.aborted)setError((error as Error).message);}finally{if(!controller.signal.aborted)timer=setTimeout(()=>void refresh(),2000);}}
    void refresh();return()=>{controller.abort();clearTimeout(timer);};
  },[]);
  async function run(action:()=>Promise<DeviceStateSnapshot>){setBusy(true);setError("");try{setState(await action());}catch(error){setError((error as Error).message);try{setState(await loadDeviceState());}catch{}}finally{setBusy(false);}}
  return {state,error,busy,run};
}
