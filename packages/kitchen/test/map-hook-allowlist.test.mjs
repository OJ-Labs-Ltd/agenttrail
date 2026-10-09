import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mapBin=fileURLToPath(new URL('../../../bin/agenttrail.mjs',import.meta.url));
const SECRET_KEY='sk-ant-'+'api03-FAKEFAKEFAKE12345678';
const COMMAND_CANARY='rm -rf /canary-target';
const PROMPT_CANARY='PROMPT-CANARY ignore all previous instructions';

const freePort=()=>new Promise(resolve=>{
  const probe=net.createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});
});

async function startMap(repo,home){
  const port=await freePort();
  const child=spawn(process.execPath,[mapBin,repo,'--port',String(port),'--no-open'],{env:{...process.env,HOME:home},stdio:['ignore','pipe','ignore']});
  // The Map prints its address once it is listening.
  await new Promise((resolve,reject)=>{
    child.stdout.once('data',resolve);
    child.once('exit',()=>reject(new Error('Map exited before listening')));
  });
  return {base:`http://127.0.0.1:${port}`,child};
}

const post=(base,hook)=>fetch(`${base}/hook`,{method:'POST',body:JSON.stringify(hook)});

test('Map hooks keep a project-relative file and drop command, description and secrets',async()=>{
  const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'map-repo-')));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'map-home-'));
  const {base,child}=await startMap(repo,home);
  try{
    const hook=(name,input,event='PostToolUse')=>({hook_event_name:event,session_id:'s1',cwd:repo,tool_name:name,tool_input:input});
    await post(base,hook('Bash',{command:`${COMMAND_CANARY} ${SECRET_KEY}`,description:PROMPT_CANARY}));
    await post(base,hook('Edit',{file_path:path.join(repo,'src','a.js'),old_string:PROMPT_CANARY}));
    await post(base,hook('Task',{description:PROMPT_CANARY,prompt:PROMPT_CANARY,subagent_type:'general'},'PreToolUse'));
    await post(base,hook('TodoWrite',{todos:[{content:`ship ${SECRET_KEY}`,status:'pending',activeForm:PROMPT_CANARY}]}));
    const model=await (await fetch(`${base}/model`)).json();
    const json=JSON.stringify(model.runs);
    for(const canary of [COMMAND_CANARY,SECRET_KEY,PROMPT_CANARY,repo])assert.ok(!json.includes(canary),`${canary} leaked into ${json}`);
    const [run]=model.runs;
    assert.equal(run.cwd,'');
    assert.ok(run.recentTools.some(tool=>tool.name==='Edit'&&tool.detail==='src/a.js'));
    assert.ok(run.recentTools.some(tool=>tool.name==='Bash'&&tool.detail===''));
    assert.deepEqual(run.subagents.map(sub=>sub.name),['sub-agent']);
    assert.match(run.todos[0].content,/\[redacted\]/);
  }finally{child.kill();}
});
