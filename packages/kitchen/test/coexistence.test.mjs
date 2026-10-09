import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {codexEvents,claudeEvents} from '../src/connectors/events.mjs';
import {hookConfig,installConfig,commandFor} from '../src/connectors/setup.mjs';
import {Projects} from '../src/agenttrail/projects.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';

const mapCli=fileURLToPath(new URL('../../../bin/agenttrail.mjs',import.meta.url));
const stamp=new Date().toISOString();

test('a Map run that is newer than Kitchen\'s native todo list does not replace it',()=>{
  const root='/work/project',store=new CrewStore([root]),projects=new Projects([root],'/home',store),at=Date.now();
  store.accept({id:'native',provider:'claude',sessionId:'one',cwd:root,at:at-1000,source:'hook',kind:'tool-end',tool:'TodoWrite',tasks:[{id:'1',title:'Write the fix',status:'in_progress'}]});
  projects.applyBoard(root,{runs:[{id:'one',agent:'claude',lastEventAt:at,todos:[]}]});
  const [session]=projects.enrich(store.snapshot());
  assert.deepEqual(session.sessionTasks.map(t=>t.title),['Write the fix']);
  assert.equal(session.taskSource,'native plan');
});

test('Codex update_plan changes the todo list only after a successful result',()=>{
  const meta={id:'s',cwd:'/repo'},base={timestamp:stamp,type:'response_item'};
  const call={...base,payload:{type:'function_call',call_id:'ok',name:'update_plan',arguments:JSON.stringify({plan:[{step:'Cook',status:'completed'}]})}};
  const [start]=codexEvents(call,meta,'f');
  assert.equal(start.tasks,undefined);
  const [done]=codexEvents({...base,payload:{type:'function_call_output',call_id:'ok',output:'Plan updated'}},meta,'f');
  assert.deepEqual(done.tasks.map(t=>[t.title,t.status]),[['Cook','completed']]);
  codexEvents({...call,payload:{...call.payload,call_id:'bad'}},meta,'f');
  const [rejected]=codexEvents({...base,payload:{type:'function_call_output',call_id:'bad',output:'failed to parse function arguments: invalid plan'}},meta,'f');
  assert.equal(rejected.tasks,undefined);
});

test('Claude TodoWrite in a log changes the todo list only after a non-error result',()=>{
  const context={pending:new Map()},row=(uuid,content)=>({type:'assistant',sessionId:'s',cwd:'/repo',uuid,timestamp:stamp,message:{content}});
  const todos=[{content:'Ship it',status:'completed',activeForm:'Shipping'}];
  const [start]=claudeEvents(row('a',[{type:'tool_use',id:'t1',name:'TodoWrite',input:{todos}}]),'f',context);
  assert.equal(start.tasks,undefined);
  const [ok]=claudeEvents(row('b',[{type:'tool_result',tool_use_id:'t1',content:'Todos have been modified successfully'}]),'f',context);
  assert.deepEqual(ok.tasks.map(t=>[t.title,t.status]),[['Ship it','completed']]);
  claudeEvents(row('c',[{type:'tool_use',id:'t2',name:'TodoWrite',input:{todos}}]),'f',context);
  const [failed]=claudeEvents(row('d',[{type:'tool_result',tool_use_id:'t2',is_error:true,content:'rejected'}]),'f',context);
  assert.equal(failed.tasks,undefined);
});

const hooksOf=async root=>JSON.parse(await fs.readFile(path.join(root,'.claude/settings.local.json'),'utf8')).hooks;
const commandsOf=(hooks,event)=>hooks[event].flatMap(group=>group.hooks.map(h=>h.command));
const installMap=root=>execFileSync(process.execPath,[mapCli,'init','--hooks-only',root],{cwd:root,stdio:'pipe'});

test('Map and Kitchen hook setups coexist in either installation order',async()=>{
  const kitchenCommand=commandFor(process.execPath,'/usr/lib/node_modules/agenttrail-kitchen/bin/relay.mjs','claude','/home/agenttrail-state');
  for(const kitchenFirst of [true,false]){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'coexist-'));
    const kitchen=async()=>installConfig(await hookConfig(root,'claude',kitchenCommand));
    if(kitchenFirst)await kitchen();
    installMap(root);
    if(!kitchenFirst)await kitchen();
    installMap(root);
    const hooks=await hooksOf(root),commands=commandsOf(hooks,'PostToolUse');
    assert.equal(commands.filter(c=>c===kitchenCommand).length,1);
    assert.equal(commands.filter(c=>/agenttrail\.mjs"? hook$/.test(c)).length,1);
    await installConfig(await hookConfig(root,'claude',kitchenCommand,true));
    assert.equal(commandsOf(await hooksOf(root),'PostToolUse').filter(c=>/agenttrail\.mjs"? hook$/.test(c)).length,1);
    assert.ok(!commandsOf(await hooksOf(root),'PostToolUse').includes(kitchenCommand));
  }
});
