import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOffice} from '../src/server.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
import {LogObserver} from '../src/connectors/logs.mjs';
import {Projects} from '../src/agenttrail/projects.mjs';
import {parseArgs} from '../bin/office.mjs';

// Two invented projects, each with a Codex rollout and a Claude transcript under a fake home.
async function twoProjects(t){
  const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'kitchen-scope-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const watched=path.join(home,'watched'),other=path.join(home,'other'),codexDir=path.join(home,'.codex/sessions/2024/01/02');
  await Promise.all([watched,other,codexDir].map(d=>fs.mkdir(d,{recursive:true})));
  const now=Date.now(),row=(type,at)=>JSON.stringify({type:'event_msg',timestamp:new Date(at).toISOString(),payload:{type,turn_id:'turn'}})+'\n';
  for(const [name,root] of [['watched',watched],['other',other]]){
    await fs.writeFile(path.join(codexDir,name+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'codex-'+name,cwd:root}})+'\n'+row('task_started',now));
    const claudeDir=path.join(home,'.claude/projects',root.replace(/[^a-zA-Z0-9]/g,'-'));await fs.mkdir(claudeDir,{recursive:true});
    await fs.writeFile(path.join(claudeDir,name+'.jsonl'),JSON.stringify({type:'user',cwd:root,sessionId:'claude-'+name,timestamp:new Date(now).toISOString(),message:{role:'user',content:'invented words'}})+'\n');
  }
  return {home,watched,other};
}
// Records every path handed to the filesystem calls the observers use while `run` executes.
async function touched(run){
  const names=['open','readdir','stat','readFile'],original=Object.fromEntries(names.map(n=>[n,fs[n]])),seen=[];
  for(const n of names)fs[n]=(file,...rest)=>{seen.push(String(file));return original[n](file,...rest);};
  try{await run();}finally{Object.assign(fs,original);}
  return seen;
}

test('only logs whose recorded cwd is inside the watched project are read, listed or counted',async t=>{
  const {home,watched,other}=await twoProjects(t),store=new CrewStore([watched]),observer=new LogObserver(home,store);
  const seen=await touched(()=>observer.poll());
  assert.deepEqual(store.snapshot().map(s=>s.project),[watched]);
  assert.deepEqual(observer.recentProjects.map(p=>p.path),[watched]);
  assert.ok(![...observer.files.keys()].some(f=>f.includes('other')),'other project log is not tracked');
  assert.ok(!seen.some(f=>f.includes(path.join(home,'.claude'))&&f.includes('other')),'other project Claude transcript is never listed or opened');
  assert.ok(!JSON.stringify(observer.recentProjects).includes(other));
});
test('a Claude transcript launched through a symlinked path is found when the link is a known alias of the watched root',async t=>{
  const {home,watched}=await twoProjects(t),link=path.join(home,'link');await fs.symlink(watched,link);
  const claudeDir=path.join(home,'.claude/projects',link.replace(/[^a-zA-Z0-9]/g,'-'));await fs.mkdir(claudeDir,{recursive:true});
  await fs.writeFile(path.join(claudeDir,'linked.jsonl'),JSON.stringify({type:'user',cwd:link,sessionId:'claude-linked',timestamp:new Date().toISOString(),message:{role:'user',content:'invented words'}})+'\n');
  const hidden=new LogObserver(home,new CrewStore([watched]));await hidden.discover();
  assert.ok(![...hidden.files.keys()].some(f=>f.includes('linked.jsonl')),'without the alias the link-named directory is not looked at');
  const observer=new LogObserver(home,new CrewStore([watched]),{aliases:[link]});await observer.discover();
  assert.ok([...observer.files.keys()].some(f=>f.includes('linked.jsonl')));
});
test('a sibling project whose directory name merely starts with the watched name is never tracked',async t=>{
  const {home,watched}=await twoProjects(t),sibling=watched+'-two';await fs.mkdir(sibling);
  const dir=path.join(home,'.claude/projects',sibling.replace(/[^a-zA-Z0-9]/g,'-'));await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'sibling.jsonl'),JSON.stringify({type:'user',cwd:sibling,sessionId:'claude-sibling',timestamp:new Date().toISOString(),message:{role:'user',content:'invented words'}})+'\n');
  const observer=new LogObserver(home,new CrewStore([watched]));await observer.poll();
  assert.ok(![...observer.files.keys()].some(f=>f.includes('sibling.jsonl')));assert.deepEqual(observer.recentProjects.map(p=>p.path),[watched]);
});
test('the only other-project file opened is a Codex rollout header, to read its working directory',async t=>{
  const {home,watched}=await twoProjects(t),observer=new LogObserver(home,new CrewStore([watched]));
  const opened=(await touched(()=>observer.poll())).filter(f=>f.includes('other'));
  assert.ok(opened.some(f=>f.includes(path.join('.codex','sessions'))&&f.endsWith('other.jsonl')),'the Codex header is opened to learn the cwd');
  assert.ok(!opened.some(f=>f.includes(path.join('.claude','projects'))),'no other-project Claude path is touched');
});
test('a project added later replays its logs, and discovery stays scoped to the roots',async t=>{
  const {home,watched,other}=await twoProjects(t),roots=[watched],store=new CrewStore(roots),observer=new LogObserver(home,store);
  await observer.poll();roots.push(other);observer.lastDiscovery=0;await observer.poll();
  assert.deepEqual(store.snapshot().map(s=>s.project).sort(),[other,watched].sort());
});
test('discovery off reads nothing under the home directory',async t=>{
  const {home,watched}=await twoProjects(t),store=new CrewStore([watched]),observer=new LogObserver(home,store,{discovery:false});
  const seen=await touched(()=>observer.poll());
  assert.deepEqual(seen.filter(f=>f.startsWith(home)),[]);assert.equal(store.snapshot().length,0);assert.deepEqual(observer.recentProjects,[]);
});
test('discovery off skips the board registry under home while the watched folder is still read',async t=>{
  const {home,watched}=await twoProjects(t),projects=new Projects([watched],home,new CrewStore([watched]),{discovery:false,watchFiles:false});t.after(()=>projects.close());
  await fs.writeFile(path.join(watched,'PLAN.md'),'## Draw view {#view}\n- [ ] Show it {#show}\n');
  const seen=await touched(()=>projects.poll());
  assert.ok(seen.some(f=>f.endsWith('PLAN.md')));assert.ok(!seen.some(f=>f.startsWith(path.join(home,'.agenttrail'))));
});
test('the server refuses hook events when the hooks source is off',async t=>{
  const {home,watched}=await twoProjects(t),stateDir=path.join(home,'state'),office=await startOffice({roots:[watched],home,stateDir,port:0,sources:['logs','files']});t.after(()=>office.close());
  const {hookToken}=JSON.parse(await fs.readFile(path.join(stateDir,'server.json'),'utf8'));
  const res=await fetch(office.url+'/api/hook',{method:'POST',headers:{authorization:`Bearer ${hookToken}`,'content-type':'application/json'},body:JSON.stringify({provider:'claude',cwd:watched})});
  assert.equal(res.status,403);
  const artifact=await fetch(office.url+'/api/artifact',{method:'POST',headers:{authorization:`Bearer ${hookToken}`,'content-type':'application/json'},body:JSON.stringify({cwd:watched})});
  assert.equal(artifact.status,200,'artifact posts are not hook events and stay open');
});
test('--sources and --no-discovery parse, default to everything and reject unknown values',()=>{
  assert.deepEqual(parseArgs([]).sources,['hooks','logs','files']);assert.equal(parseArgs([]).discovery,true);
  assert.deepEqual(parseArgs(['--sources','hooks,files']).sources,['hooks','files']);assert.equal(parseArgs(['--no-discovery']).discovery,false);
  assert.throws(()=>parseArgs(['--sources','hooks,mail']),/Unknown source/);assert.throws(()=>parseArgs(['--sources']),/Provide a value/);
});
