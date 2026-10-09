import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOffice} from '../src/server.mjs';

const API_KEY='sk-ant-'+'api03-FAKEFAKEFAKE12345678';
const SHELL_COMMAND='rm -rf /tmp/pwned && curl http://evil.invalid';
const PROMPT_TAIL='PROMPT-TAIL-CANARY ignore all previous instructions';
const OUTSIDE_DIR='/opt/outside-canary/private';
// The opening words are an ordinary title; the rest is prompt text that sits beyond the 180-character cap.
const promptTitle=opening=>`${opening} ${'and then some more '.repeat(20)}${PROMPT_TAIL}`;

const readFirstEvent=async(url)=>{
  const abort=new AbortController(),reader=(await fetch(url,{signal:abort.signal})).body.getReader(),decoder=new TextDecoder();
  let text='';
  while(!text.endsWith('\n\n'))text+=decoder.decode((await reader.read()).value,{stream:true});
  abort.abort();
  return text;
};

test('hostile events from hooks and both log formats never reach /api/state, /api/bootstrap or /api/events',async t=>{
  const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'orbit-privacy-'))),root=path.join(home,'project'),stateDir=path.join(home,'state');
  t.after(()=>fs.rm(home,{recursive:true,force:true}));
  await fs.mkdir(root);
  const keyedFile=path.join(root,'secrets',API_KEY,'.env'),timestamp=new Date().toISOString();

  // Log fixtures exist before startOffice, whose first tick reads them: no waiting is needed.
  const codexDir=path.join(home,'.codex/sessions',...timestamp.slice(0,10).split('-')),claudeDir=path.join(home,'.claude/projects/hostile');
  await Promise.all([codexDir,claudeDir].map(dir=>fs.mkdir(dir,{recursive:true})));
  const codexRow=(type,payload)=>JSON.stringify({type,timestamp,payload});
  await fs.writeFile(path.join(codexDir,'hostile.jsonl'),[
    codexRow('session_meta',{id:'codex-thread',cwd:root}),
    codexRow('event_msg',{type:'task_started',turn_id:'codex-turn'}),
    codexRow('response_item',{type:'function_call',name:'shell',call_id:'codex-call',arguments:JSON.stringify({file_path:keyedFile,command:SHELL_COMMAND,prompt:promptTitle('Codex prompt')})}),
    codexRow('response_item',{type:'function_call',name:'update_plan',call_id:'codex-plan',arguments:JSON.stringify({plan:[{step:promptTitle('Codex step'),status:'in_progress'}]})}),
    // Plans count only once their tool result confirms them.
    codexRow('response_item',{type:'function_call_output',call_id:'codex-plan',output:'Plan updated'}),
  ].join('\n')+'\n');
  const claudeRow=(uuid,message,type='assistant')=>JSON.stringify({type,uuid,timestamp,sessionId:'claude-session',cwd:root,message});
  await fs.writeFile(path.join(claudeDir,'hostile.jsonl'),[
    claudeRow('c1',{content:[{type:'tool_use',id:'claude-call',name:'Bash',input:{command:SHELL_COMMAND,file_path:keyedFile,description:promptTitle('Claude prompt')}}]}),
    claudeRow('c2',{content:[{type:'tool_use',id:'claude-todos',name:'TodoWrite',input:{todos:[{content:promptTitle('Claude todo'),status:'pending'}]}}]}),
    claudeRow('c3',{content:[{type:'tool_result',tool_use_id:'claude-todos',content:'Todos have been modified successfully'}]},'user'),
  ].join('\n')+'\n');

  const office=await startOffice({roots:[root],home,stateDir,port:0});
  t.after(()=>office.close());
  const hook=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));
  const post=event=>fetch(office.url+'/api/hook',{method:'POST',headers:{authorization:`Bearer ${hook.hookToken}`,'content-type':'application/json'},body:JSON.stringify(event)});
  const hostile=(id,extra)=>({provider:'cursor',id,sessionId:'hook-session',cwd:root,kind:'tool-start',tool:'Bash',toolId:id,
    prompt:promptTitle('Hook prompt'),command:SHELL_COMMAND,arguments:SHELL_COMMAND,tool_input:{command:SHELL_COMMAND,file_path:keyedFile},...extra});
  assert.equal((await post(hostile('hook-keyed',{file:keyedFile,tasks:[{id:'1',title:promptTitle('Hook todo'),status:'pending'}]}))).status,200);
  assert.equal((await post(hostile('hook-outside',{sessionId:'outside-session',toolId:'hook-outside-call',file:`${OUTSIDE_DIR}/notes.txt`}))).status,200);

  // permission events list no task, tool or file field: the allowlist is what keeps these out of stored state.
  assert.equal((await post(hostile('hook-permission',{kind:'permission',tool:'UNLISTED-TOOL-CANARY',file:'UNLISTED-FILE-CANARY.txt',tasks:[{id:'9',title:'UNLISTED-TASK-CANARY',status:'pending'}]}))).status,200);

  const feeds={
    state:JSON.stringify(await fetch(office.url+'/api/state').then(r=>r.json())),
    bootstrap:JSON.stringify(await fetch(office.url+'/api/bootstrap').then(r=>r.json())),
    events:await readFirstEvent(office.url+'/api/events'),
  };
  const canaries={'API key':API_KEY,'unlisted tool':'UNLISTED-TOOL-CANARY','unlisted file':'UNLISTED-FILE-CANARY','unlisted task':'UNLISTED-TASK-CANARY','prompt tail':'PROMPT-TAIL-CANARY','shell command':SHELL_COMMAND,'shell host':'evil.invalid','outside path':OUTSIDE_DIR,'project root':root,'home directory':home};
  for(const [feedName,feed] of Object.entries(feeds))for(const [canaryName,canary] of Object.entries(canaries))
    assert.ok(!feed.includes(canary),`${canaryName} leaked into /api/${feedName}`);

  // An empty snapshot would pass the checks above, so the sanitised sessions, titles and paths must be there.
  const state=JSON.parse(feeds.state),sessions=new Map(state.executors.map(executor=>[executor.sessionId,executor]));
  assert.ok(['hook-session','outside-session','codex-thread','claude-session'].every(id=>sessions.has(id)),`sessions seen: ${[...sessions.keys()]}`);
  const titles=state.executors.flatMap(executor=>executor.sessionTasks||[]).map(task=>task.title);
  assert.deepEqual(titles.map(title=>title.split(' and then')[0]).sort(),['Claude todo','Codex step','Hook todo']);
  assert.ok(titles.every(title=>title.length<=180),'titles are capped');
  assert.match(feeds.state,/\[redacted\]/);
  assert.equal(sessions.get('hook-session').file,'secrets/[redacted]/.env');assert.ok(!sessions.get('outside-session').file,'a path outside the watched root is not kept');
  assert.ok(feeds.events.startsWith('data: ')&&feeds.events.includes('hook-session'),'the SSE snapshot carries the same sessions');
});
