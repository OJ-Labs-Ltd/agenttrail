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
import {projectHandle} from '../src/runtime/payload-allowlist.mjs';
import {spawn,execFile} from 'node:child_process';
import net from 'node:net';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const officeCli=fileURLToPath(new URL('../bin/office.mjs',import.meta.url)),mapCli=fileURLToPath(new URL('../../../bin/agenttrail.mjs',import.meta.url));
const freePort=()=>new Promise(resolve=>{const probe=net.createServer().listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});
// Starts a CLI and resolves with its stdout once `ready` matches; the child is killed when the test ends.
function startCli(t,script,args,env,ready){
  const child=spawn(process.execPath,[script,...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});t.after(()=>child.kill());
  return new Promise((resolve,reject)=>{let out='';child.stdout.on('data',c=>{out+=c;if(ready.test(out))resolve(out);});child.on('exit',code=>reject(new Error('exited '+code+': '+out)));});
}
// A Claude transcript filed under the directory name Claude would give a session launched from `launchedFrom`.
async function claudeTranscript(home,launchedFrom,name){
  const dir=path.join(home,'.claude/projects',launchedFrom.replace(/[^a-zA-Z0-9]/g,'-'));await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,name+'.jsonl'),JSON.stringify({type:'user',cwd:launchedFrom,sessionId:'claude-'+name,timestamp:new Date().toISOString(),message:{role:'user',content:'invented words'}})+'\n'+JSON.stringify({type:'assistant',cwd:launchedFrom,sessionId:'claude-'+name,uuid:'tool-one',timestamp:new Date().toISOString(),message:{content:[{type:'tool_use',id:'read-one',name:'Read',input:{file_path:path.join(launchedFrom,'notes.txt')}}]}})+'\n');
}

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
test('attaching a symlinked folder to a running Kitchen lets its observer see the link-named Claude directory',async t=>{
  const {home,watched,other}=await twoProjects(t),link=path.join(home,'link-to-other');await fs.symlink(other,link);await claudeTranscript(home,link,'via-link');
  const stateDir=path.join(home,'state'),office=await startOffice({roots:[watched],home,stateDir,port:0});t.after(()=>office.close());
  await promisify(execFile)(process.execPath,[officeCli,link,'--state-dir',stateDir,'--no-open'],{timeout:10000});
  assert.ok(office.snapshot().executors.some(e=>e.project===projectHandle(other)&&e.id.endsWith('claude-via-link')));
});
test('a symlinked folder stays known to the link-named Claude directory after the saved folders are reloaded',async t=>{
  const {home,watched}=await twoProjects(t),link=path.join(home,'link-to-watched');await fs.symlink(watched,link);
  const stateDir=path.join(home,'state'),port=await freePort();
  await startCli(t,officeCli,[link,'--state-dir',stateDir,'--no-open','--port',String(port)],{},/ready/);
  assert.ok(JSON.parse(await fs.readFile(path.join(stateDir,'projects.json'),'utf8')).includes(link),'the path the user gave is saved beside the real path');
});
test('Map suggests no other repository by default, from ~/.agenttrail or from sibling folders',async t=>{
  const home=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'map-suggest-')));t.after(()=>fs.rm(home,{recursive:true,force:true}));
  const repo=path.join(home,'work','watched'),sibling=path.join(home,'work','sibling');
  await fs.mkdir(path.join(sibling,'.git'),{recursive:true});await fs.mkdir(repo,{recursive:true});await fs.mkdir(path.join(home,'.agenttrail'));
  await fs.writeFile(path.join(home,'.agenttrail','abc.json'),JSON.stringify({repoPath:sibling}));
  const port=await freePort();await startCli(t,mapCli,[repo,'--no-open','--port',String(port)],{HOME:home},/http:\/\/localhost/);
  assert.deepEqual(await fetch(`http://127.0.0.1:${port}/suggest`).then(r=>r.json()),[]);
});
