import test from "node:test";
import assert from "node:assert/strict";
import { writeFile,mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand,commandSpec,WindowsExecutor } from "../native/executor.ts";
import type { CommandAction } from "../lib/model.ts";
test("Windows command runner preserves arguments, reports failures and kills timeouts",{skip:process.platform!=="win32"},async()=>{
  const directory=await mkdtemp(join(tmpdir(),"keymap-executor-")),path=join(directory,"script with spaces.ps1");
  await writeFile(path,'[Console]::WriteLine((ConvertTo-Json -InputObject @($args) -Compress))');
  const action:CommandAction={kind:"command",runner:"powershell",path,arguments:["argumento com espaço","a&b","quote\"x"],cwd:directory,timeoutMs:5000};
  const output=await runCommand(action,new AbortController().signal);assert.deepEqual(JSON.parse(output),action.arguments);
  await writeFile(path,"exit 7");await assert.rejects(runCommand(action,new AbortController().signal),/código 7/);
  await writeFile(path,"Start-Sleep -Seconds 10");await assert.rejects(runCommand({...action,timeoutMs:1000},new AbortController().signal),/Tempo máximo/);
  const batch=join(directory,"test.cmd");await writeFile(batch,"@echo off\r\necho %~1\r\n");
  assert.equal(await runCommand({...action,runner:"batch",path:batch,arguments:["argumento com espaço"]},new AbortController().signal),"argumento com espaço");
  await assert.rejects(commandSpec({...action,runner:"batch",path:batch,arguments:["hello & calc.exe"]}),/caracteres de shell/);
  const python=join(directory,"argumentos.py");
  await writeFile(python,'import json\nimport sys\n\nprint(json.dumps(sys.argv[1:]))\n');
  assert.deepEqual(JSON.parse(await runCommand({...action,runner:"python",path:python,arguments:["ação com espaço","a&b"]},new AbortController().signal)),["ação com espaço","a&b"]);
  const controller=new AbortController();setTimeout(()=>controller.abort(),250);
  await assert.rejects(runCommand(action,controller.signal),/cancelada/);
});
test("persistent SendInput host compiles and starts without injecting keyboard input",{skip:process.platform!=="win32"},async()=>{
  const executor=new WindowsExecutor();try{await executor.start();}finally{await executor.close();}
});
