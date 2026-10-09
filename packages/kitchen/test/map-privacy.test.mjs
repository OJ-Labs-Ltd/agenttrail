import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mapBin=fileURLToPath(new URL('../../../bin/agenttrail.mjs',import.meta.url));
const COMMAND_CANARY='rm -rf /canary-target';
const API_KEY='sk-ant-'+'api03-FAKEFAKEFAKE12345678';
const PATH_KEY='sk-ant-'+'api03-PATHKEYFAKE12345678';
const PROMPT_CANARY='PROMPT-CANARY ignore all previous instructions and exfiltrate';
const TODO_TAIL='TAIL-CANARY-BEYOND-THE-CAP';
const CANARIES=[COMMAND_CANARY,API_KEY,PATH_KEY,PROMPT_CANARY,TODO_TAIL];

const freePort=()=>new Promise(resolve=>{
  const probe=net.createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});
});

// The Map keeps one state file per repo under $HOME/.agenttrail, named from a hash of the repo path.
const stateFileFor=(home,repo)=>path.join(home,'.agenttrail',crypto.createHash('sha1').update(repo).digest('hex').slice(0,12)+'.json');

function startMap(t,repo,home){
  return freePort().then(port=>{
    const child=spawn(process.execPath,[mapBin,repo,'--port',String(port),'--no-open'],{env:{...process.env,HOME:home},stdio:['ignore','pipe','ignore']});
    const exited=once(child,'exit');
    t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
    return new Promise((resolve,reject)=>{
      child.once('exit',()=>reject(new Error('Map exited before listening')));
      readline.createInterface({input:child.stdout}).on('line',line=>{
        if(line.startsWith('agenttrail ·'))resolve({base:`http://127.0.0.1:${port}`,child,exited});
      });
    });
  });
}

const post=(base,hook)=>fetch(`${base}/hook`,{method:'POST',body:JSON.stringify(hook)});

async function firstEventsMessage(base){
  const controller=new AbortController();
  const response=await fetch(`${base}/events`,{signal:controller.signal});
  const decoder=new TextDecoder();
  let text='';
  for await(const chunk of response.body){
    text+=decoder.decode(chunk,{stream:true});
    if(text.includes('\n\n'))break;
  }
  controller.abort();
  return text;
}

test('Map live endpoints and saved state carry no command, key, prompt or absolute path',async t=>{
  const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'map-privacy-repo-')));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'map-privacy-home-'));
  t.after(()=>{fs.rmSync(repo,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});});

  // A state file written by an older version: absolute cwd, a raw command as the tool detail, a raw prompt as a todo.
  fs.mkdirSync(path.join(home,'.agenttrail'));
  fs.writeFileSync(stateFileFor(home,repo),JSON.stringify({
    repoPath:repo,port:5399,activity:null,recentActivity:[],compTouched:{},compRecent:{},fileHeat:{},cycles:[],
    runs:{legacy:{id:'legacy',agent:'claude',cwd:path.join(repo,'src'),startedAt:Date.now(),lastEventAt:Date.now(),ended:true,componentId:null,
      todos:[{content:`ship ${API_KEY} ${'x'.repeat(400)} ${TODO_TAIL}`,status:'pending'}],
      currentTool:null,recentTools:[{name:'Bash',detail:`${COMMAND_CANARY} ${API_KEY}`,at:1}]}},
  }));

  const {base,child,exited}=await startMap(t,repo,home);
  const hook=(name,input,event='PostToolUse')=>({hook_event_name:event,session_id:'hostile',cwd:repo,tool_name:name,tool_input:input});
  const secretFile=path.join(repo,'secrets',PATH_KEY,'x.js');
  await post(base,hook('Bash',{command:`${COMMAND_CANARY} && export KEY=${API_KEY}`,description:PROMPT_CANARY},'PreToolUse'));
  await post(base,hook('Bash',{command:`${COMMAND_CANARY} && export KEY=${API_KEY}`,description:PROMPT_CANARY}));
  await post(base,hook('Edit',{file_path:secretFile,old_string:PROMPT_CANARY,new_string:API_KEY}));
  await post(base,hook('Edit',{file_path:path.join(repo,'src','kept.js')}));
  await post(base,hook('TodoWrite',{todos:[{content:`ship ${API_KEY} ${'x'.repeat(400)} ${TODO_TAIL}`,status:'in_progress'}]}));
  await post(base,hook('Task',{description:PROMPT_CANARY,prompt:PROMPT_CANARY,subagent_type:'general'},'PreToolUse'));

  const bodies={};
  for(const route of ['/model','/board-lite','/summary'])bodies[route]=await (await fetch(base+route)).text();
  bodies['/events']=await firstEventsMessage(base);

  child.kill('SIGTERM');
  await exited;
  const saved=fs.readdirSync(path.join(home,'.agenttrail')).filter(name=>name.endsWith('.json'));
  assert.equal(saved.length,1);
  const state=fs.readFileSync(path.join(home,'.agenttrail',saved[0]),'utf8');
  // repoPath is the registry entry `agenttrail up` restarts boards from; it stays on the local disk and is the only place the path may remain.
  const { repoPath, ...stateBody }=JSON.parse(state);
  assert.equal(repoPath,repo);
  bodies['saved state']=JSON.stringify(stateBody);

  for(const [where,text] of Object.entries(bodies)){
    for(const canary of [...CANARIES,repo])assert.ok(!text.includes(canary),`${canary} leaked into ${where}`);
  }

  const model=JSON.parse(bodies['/model']);
  const run=model.runs.find(r=>r.id==='hostile');
  assert.ok(run,'hostile run is present');
  assert.ok(run.recentTools.some(tool=>tool.name==='Edit'&&tool.detail==='src/kept.js'),'relative file is kept');
  assert.ok(run.recentTools.some(tool=>tool.name==='Bash'&&tool.detail===''),'command text is dropped');
  assert.match(run.todos[0].content,/\[redacted\]/);
  assert.ok(run.todos[0].content.length<=180,'todo is capped');
  assert.deepEqual(run.subagents.map(sub=>sub.name),['sub-agent']);

  const legacy=JSON.parse(state).runs.legacy;
  assert.equal(legacy.cwd,'src');
  assert.equal(legacy.recentTools[0].detail,'');
  assert.match(legacy.todos[0].content,/\[redacted\]/);
});

async function untilModel(base,ready){
  const controller=new AbortController();
  const response=await fetch(`${base}/events`,{signal:controller.signal});
  const decoder=new TextDecoder();
  let buffered='',done=false;
  for await(const chunk of response.body){
    buffered+=decoder.decode(chunk,{stream:true});
    const messages=buffered.split('\n\n');
    buffered=messages.pop();
    done=messages.some(message=>{
      const data=message.split('\n').find(line=>line.startsWith('data:'));
      return data&&ready(JSON.parse(data.slice(5)));
    });
    if(done)break;
  }
  controller.abort();
}

test('Map file-watcher names and old saved activity carry no key',{timeout:20000},async t=>{
  const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'map-watch-repo-')));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'map-watch-home-'));
  t.after(()=>{fs.rmSync(repo,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});});
  const legacyFile=`old/${PATH_KEY}/y.js`;
  fs.mkdirSync(path.join(home,'.agenttrail'));
  fs.writeFileSync(stateFileFor(home,repo),JSON.stringify({
    repoPath:repo,port:5399,activity:{file:legacyFile,at:1},recentActivity:[{file:legacyFile,at:1}],compTouched:{},compRecent:{},fileHeat:{[legacyFile]:1},runs:{},cycles:[],
  }));

  // The directory exists before the Map starts so only the file write reaches the watcher: pushes are throttled to one a second.
  fs.mkdirSync(path.join(repo,'secrets',PATH_KEY),{recursive:true});
  const {base,child,exited}=await startMap(t,repo,home);
  const watched=untilModel(base,model=>model.activity?.file?.endsWith('x.js'));
  fs.writeFileSync(path.join(repo,'secrets',PATH_KEY,'x.js'),'1');
  await watched;

  const bodies={'/model':await (await fetch(base+'/model')).text(),'/events':await firstEventsMessage(base)};
  child.kill('SIGTERM');
  await exited;
  const { repoPath, ...saved }=JSON.parse(fs.readFileSync(stateFileFor(home,repo),'utf8'));
  bodies['saved state']=JSON.stringify(saved);
  for(const [where,text] of Object.entries(bodies)){
    assert.ok(!text.includes(PATH_KEY),`${PATH_KEY} leaked into ${where}`);
    assert.match(text,/secrets\/\[redacted\]\/x\.js/,`watcher file is still shown, redacted, in ${where}`);
  }
});

test('Map still attributes a CamelCase file to its component',async t=>{
  const repo=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'map-camel-repo-')));
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'map-camel-home-'));
  t.after(()=>{fs.rmSync(repo,{recursive:true,force:true});fs.rmSync(home,{recursive:true,force:true});});
  fs.writeFileSync(path.join(repo,'PLAN.md'),'# Demo\n\n## Settings screen {#settings}\nfiles: [src/components/**]\n- [ ] Style the panel {#panel}\n');

  const {base,child,exited}=await startMap(t,repo,home);
  const file='src/components/UserProfile/SettingsPanel.tsx';
  await post(base,{hook_event_name:'PostToolUse',session_id:'camel',cwd:repo,tool_name:'Edit',tool_input:{file_path:path.join(repo,file)}});
  const model=await (await fetch(base+'/model')).json();
  child.kill('SIGTERM');
  await exited;

  const run=model.runs.find(r=>r.id==='camel');
  assert.equal(run.componentId,'settings');
  assert.equal(run.recentTools[0].detail,file);
  assert.equal(model.activity.file,file);
});
