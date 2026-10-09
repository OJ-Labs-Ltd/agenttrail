import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOffice} from '../src/server.mjs';
import {normalizeHook} from '../src/connectors/events.mjs';
import {validate,validateFeed} from '../src/connectors/feed.mjs';

const claudeRaw=cwd=>({hook_event_name:'PreToolUse',session_id:'claude-session',cwd,tool_use_id:'tool-1',tool_name:'Write',tool_input:{file_path:path.join(cwd,'src/main.js')},office_event_id:'claude-1'});
const cursorRaw=cwd=>({hook_event_name:'subagentStart',conversation_id:'cursor-parent',subagent_id:'cursor-child',workspace_roots:[cwd],generation_id:'turn-1',office_event_id:'cursor-1'});

test('validator rejects an unknown property, a missing property, a wrong type and a bad enum value without echoing values',()=>{
  const hook=normalizeHook('claude',claudeRaw('/repo'));
  assert.deepEqual(validateFeed('hookEvent',hook),[]);
  assert.deepEqual(validateFeed('hookEvent',{...hook,extra:'LEAKED-EXTRA'}),['$.extra: unknown property']);
  const {cwd,...withoutCwd}=hook;
  assert.deepEqual(validateFeed('hookEvent',withoutCwd),['$.cwd: required']);
  assert.deepEqual(validateFeed('hookEvent',{...hook,sessionId:'LEAKED-TYPE'.length}),['$.sessionId: expected string']);
  assert.deepEqual(validateFeed('hookEvent',{...hook,kind:'LEAKED-KIND'}),['$.kind: not one of the allowed values']);
  assert.deepEqual(validateFeed('hookEvent',{...hook,tasks:[{title:'x',status:'LEAKED-STATUS'}]}),['$.tasks[0].status: not one of the allowed values']);
  assert.deepEqual(validateFeed('hookEvent',{...hook,tool:'x'.repeat(81)}),['$.tool: longer than 80 characters']);
  assert.deepEqual(validateFeed('hookEvent',{...hook,id:''}),['$.id: does not match the required pattern']);
  assert.deepEqual(validateFeed('hookEvent',[]),['$: expected object']);
});
test('validator refuses a schema keyword it does not implement',()=>{
  assert.throws(()=>validate({oneOf:[]},{},{}),/Unsupported schema keyword: oneOf/);
});
test('normalizeHook output from claude and cursor validates as a hook event',()=>{
  for(const event of [normalizeHook('claude',claudeRaw('/repo')),normalizeHook('cursor',cursorRaw('/repo'))])assert.deepEqual(validateFeed('hookEvent',event),[]);
  const todo=normalizeHook('claude',{hook_event_name:'PostToolUse',session_id:'s',cwd:'/repo',office_event_id:'todo',tool_name:'TodoWrite',tool_input:{todos:[{id:'1',content:'First',status:'in_progress'}],merge:true}});
  assert.deepEqual(validateFeed('hookEvent',JSON.parse(JSON.stringify(todo))),[]);
  const change=normalizeHook('claude',{hook_event_name:'PostToolUse',session_id:'s',cwd:'/repo',office_event_id:'change',tool_name:'TaskUpdate',tool_input:{taskId:'1',status:'completed'},tool_response:{task:{id:'1',status:'completed'}}});
  assert.deepEqual(validateFeed('hookEvent',JSON.parse(JSON.stringify(change))),[]);
});
test('a real snapshot, stream message and artifact event validate against the schema',async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'feed-schema-')),root=path.join(home,'project'),stateDir=path.join(home,'state');
  const bare=path.join(home,'bare');
  await fs.mkdir(path.join(root,'drafts'),{recursive:true});await fs.mkdir(path.join(root,'src'));await fs.mkdir(path.join(bare,'src'),{recursive:true});
  const components=['research','write','evaluate','queue','publisher','manager'].map(id=>`## ${id[0].toUpperCase()+id.slice(1)} {#${id}}\nfiles: [${id==='write'?'src/**':id+'/**'}]\nneeds: [manager]\nlinks: [write]\n${id==='queue'?'kind: human\nurl: https://example.invalid/review\n':''}- [~] Do the ${id} work {#${id}-task}\n  by: claude\n  from: agent\n`).join('\n');
  await fs.writeFile(path.join(root,'PLAN.md'),components);
  await fs.writeFile(path.join(root,'drafts/one.md'),'---\ntitle_a: Invented draft\nsubreddit: invented\nstatus: draft\n---\nInvented body.\n');
  const office=await startOffice({roots:[root,bare],home,stateDir,port:0,observe:false});
  t.after(async()=>{await office.close();await fs.rm(home,{recursive:true,force:true});});
  const hookToken=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8')).hookToken;
  const headers={authorization:`Bearer ${hookToken}`,'content-type':'application/json'};
  const post=(route,body)=>fetch(office.url+route,{method:'POST',headers,body:JSON.stringify(body)}).then(r=>r.json());
  const hook=(provider,raw)=>post('/api/hook',normalizeHook(provider,raw));
  const todos=[{id:'1',content:'Draft the post',status:'in_progress'},{id:'2',content:'Review the post',status:'pending'},{id:'3',content:'Gather notes',status:'completed'}];
  for(const raw of [{...claudeRaw(root),hook_event_name:'SessionStart',office_event_id:'a1'},{...claudeRaw(root),hook_event_name:'PostToolUse',tool_name:'TodoWrite',tool_input:{todos},office_event_id:'a2'},{...claudeRaw(root),office_event_id:'a3'}])assert.equal((await hook('claude',raw)).accepted,true);
  assert.equal((await hook('cursor',cursorRaw(root))).accepted,true);
  // Events that no hook produces but POST /api/hook accepts: a bound role and a completed piece of observed work.
  const roleEvent={id:'role-1',provider:'claude',sessionId:'claude-session',cwd:root,kind:'role',roleId:'write',workflowId:'project',runId:'run-1'};
  const workEvent={id:'work-1',provider:'claude',sessionId:'claude-session',cwd:root,kind:'observation',work:{category:'build',label:'Edit main.js',file:'src/main.js',completed:true}};
  // A root with no PLAN.md gets an inferred workflow, the only kind that attributes observed work to a role.
  const bareEvent={...workEvent,id:'work-2',sessionId:'claude-bare',cwd:bare,work:{...workEvent.work,file:'src/app.js'}};
  for(const event of [roleEvent,workEvent,bareEvent]){assert.deepEqual(validateFeed('hookEvent',event),[]);assert.equal((await post('/api/hook',event)).accepted,true);}
  const artifact={id:'output',artifactId:'result',revisionId:'revision-a',kind:'produced',provider:'claude',sessionId:'claude-session',cwd:root,type:'json',file:'src/result.json',label:'Result'};
  assert.deepEqual(validateFeed('artifactEvent',artifact),[]);
  assert.equal((await post('/api/artifact',artifact)).accepted,true);
  const transfer={...artifact,id:'receipt',kind:'received',handoffId:'delivery',recipientProvider:'cursor',recipientSessionId:'cursor-child'};
  assert.deepEqual(validateFeed('artifactEvent',transfer),[]);
  assert.equal((await post('/api/artifact',transfer)).accepted,true);
  const state=await fetch(office.url+'/api/state').then(r=>r.json());
  assert.ok(state.executors.length>=2&&state.orders.length===3&&state.transfers.length===1&&state.artifacts.some(a=>a.source==='workflow files'));
  assert.deepEqual(validateFeed('snapshot',state),[]);
  // The scenario must reach the optional shapes, and a stray field must be caught at depth, or the check above proves little.
  assert.ok(state.executors.some(e=>e.roleBinding&&e.workContext&&e.workHistory)&&state.crew.some(c=>c.recentWork)&&state.projects[0].workflow.queue.items.length===1&&state.projects[1].workflow.origin==='inferred');
  const stray=structuredClone(state);stray.crew.find(c=>c.executors?.length).executors[0].stray=1;stray.projects[0].workflow.queue.items[0].stray=1;stray.orders[0].contributors.push({stray:1});
  assert.deepEqual(validateFeed('snapshot',stray).filter(e=>e.endsWith('unknown property')).length,3);
  const controller=new AbortController(),stream=await fetch(office.url+'/api/events',{signal:controller.signal});
  const {value}=await stream.body.getReader().read();controller.abort();
  assert.deepEqual(validateFeed('snapshot',JSON.parse(new TextDecoder().decode(value).replace(/^data: /,''))),[]);
});
