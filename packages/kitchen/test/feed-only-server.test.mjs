import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOffice} from '../src/server.mjs';
import {Projects} from '../src/agenttrail/projects.mjs';
import {CrewStore} from '../src/runtime/crew.mjs';
import {validateFeed} from '../src/connectors/feed.mjs';
import {projectHandle} from '../src/runtime/payload-allowlist.mjs';

const feedToken='feed-token-0123456789abcdef';
// The state directory is never created in feed-only mode, so the test points at one that must stay absent.
async function startFeed(t,options={}){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-feed-')),root=path.join(home,'project'),stateDir=path.join(home,'state');await fs.mkdir(root);
  const office=await startOffice({roots:[root],home,stateDir,port:0,feedOnly:true,feedToken,...options});
  t.after(async()=>{await office.close();await fs.rm(home,{recursive:true,force:true});});
  const fetcher=(url,options={})=>fetch(office.url+url,options);
  return {office,root,stateDir,fetcher};
}
const event=root=>({provider:'cursor',id:'fixture',sessionId:'live-session',cwd:root,kind:'tool-start',tool:'Write',toolId:'tool',file:path.join(root,'main.js')});

test('feed-only start refuses a missing or short token before binding a port',async()=>{
  const roots=[os.tmpdir()],stateDir=path.join(os.tmpdir(),'orbit-feed-refused');
  await assert.rejects(()=>startOffice({roots,home:os.tmpdir(),stateDir,port:0,feedOnly:true}),/feed token/i);
  await assert.rejects(()=>startOffice({roots,home:os.tmpdir(),stateDir,port:0,feedOnly:true,feedToken:'short'}),/feed token/i);
  await assert.rejects(()=>fs.stat(stateDir));
});
test('feed-only intake needs the bearer token and validates the body without echoing values',async t=>{
  const {root,fetcher}=await startFeed(t);
  const post=(url,body,token=feedToken)=>fetcher(url,{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{}),'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post('/api/hook',event(root),null)).status,403);
  assert.equal((await post('/api/hook',event(root),'wrong-token-0123456789')).status,403);
  const rejected=await post('/api/hook',{...event(root),arguments:'LEAKED-ARGUMENT'});
  assert.equal(rejected.status,400);
  const text=await rejected.text();assert.match(text,/\$\.arguments: unknown property/);assert.ok(!text.includes('LEAKED-ARGUMENT'));
  assert.equal((await post('/api/artifact',{id:'a',artifactId:'r',revisionId:'v',kind:'produced',provider:'cursor',sessionId:'s',cwd:root,body:'LEAKED-BODY'})).status,400);
  const accepted=await post('/api/hook',event(root)).then(r=>r.json());assert.equal(accepted.accepted,true);
  const artifact={id:'output',artifactId:'result',revisionId:'revision-a',kind:'produced',provider:'cursor',sessionId:'live-session',cwd:root,type:'json',file:'result.json'};
  assert.equal((await post('/api/artifact',artifact).then(r=>r.json())).accepted,true);
});
test('feed-only serves only the documented routes, no csrf token, and touches no state directory',async t=>{
  const {root,stateDir,fetcher}=await startFeed(t);
  const post=url=>fetcher(url,{method:'POST',headers:{authorization:`Bearer ${feedToken}`,'content-type':'application/json'},body:'{}'});
  for(const url of ['/api/attach','/api/projects','/api/setup/preview','/api/setup/apply'])assert.ok([404,405].includes((await post(url)).status),url);
  assert.equal((await fetcher('/')).status,200);
  const boot=await fetcher('/api/bootstrap').then(r=>r.json());
  assert.ok(!('token' in boot));assert.ok(!JSON.stringify(boot).includes(feedToken));
  assert.deepEqual(validateFeed('snapshot',boot),[]);
  assert.deepEqual([boot.recentProjects,boot.discoveryLimited,boot.installed,boot.observing],[[],false,{},false]);
  assert.deepEqual(Object.values(boot.observers).map(o=>o.available),[false,false,undefined]);
  assert.equal(boot.projects[0].id,projectHandle(root));assert.ok(!JSON.stringify(boot).includes(root));assert.equal(boot.projects[0].watchStatus,'feed');assert.equal(boot.projects[0].contextSource,'feed');
  await assert.rejects(()=>fs.stat(stateDir));
});
test('feed-only Projects seeds one record per root without touching the filesystem',async()=>{
  const missing=path.join(os.tmpdir(),'orbit-feed-missing-root');
  const projects=new Projects([missing],'/nonexistent-home',new CrewStore([missing]),{feedOnly:true});
  await projects.poll();
  const [project]=projects.snapshot();
  assert.deepEqual([project.id,project.components,project.workflow,project.contextSource,project.watchStatus],[missing,[],null,'feed','feed']);
  assert.equal(projects.watchers.length,0);
});
