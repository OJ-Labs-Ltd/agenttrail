import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from '../bin/office.mjs';

const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../bin/office.mjs');
const feedToken='cli-feed-token-0123456789abcdef';
const freePort=()=>new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});
// A scratch HOME and state dir prove nothing is written outside the process: the tests assert both stay empty.
async function spawnKitchen(t,args,env={}){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-feed-cli-')),stateDir=path.join(home,'state');
  const {AGENTTRAIL_FEED_TOKEN:_inherited,...baseEnv}=process.env;
  const child=spawn(process.execPath,[script,...args,'--state-dir',stateDir],{env:{...baseEnv,HOME:home,...env},stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{child.kill('SIGKILL');await exited;await fs.rm(home,{recursive:true,force:true});});
  return {child,home,stateDir,exited,output:()=>({stdout,stderr}),ready:()=>new Promise((resolve,reject)=>{
    const check=()=>{const found=stdout.match(/ready on (http:\/\/127\.0\.0\.1:\d+)/);if(found)resolve(found[1]);};
    child.stdout.on('data',check);check();exited.then(()=>reject(new Error('Exited before ready: '+stderr)));
  })};
}

test('parseArgs --feed-only needs absolute project paths and at least one of them',()=>{
  assert.equal(parseArgs(['--feed-only','--project','/logical/root']).feedOnly,true);
  assert.deepEqual(parseArgs(['--feed-only','/logical/a','--project','/logical/b/../c']).roots,['/logical/a','/logical/c']);
  assert.throws(()=>parseArgs(['--feed-only','--project','relative/root']),/absolute/);
  assert.throws(()=>parseArgs(['--feed-only','.']),/absolute/);
  assert.throws(()=>parseArgs(['--feed-only']),/at least one/);
  assert.deepEqual(parseArgs(['.'],'/projects/one').roots,['/projects/one']);
});
test('feed-only CLI refuses to start without a token or with a short one',async t=>{
  for(const env of [{},{AGENTTRAIL_FEED_TOKEN:'short'}]){
    const kitchen=await spawnKitchen(t,['--feed-only','--project','/logical/root','--port',String(await freePort())],env);
    const result=await kitchen.exited,{stdout,stderr}=kitchen.output();
    assert.equal(result.code,1);assert.match(stderr,/AGENTTRAIL_FEED_TOKEN/);assert.equal(stdout,'');
    await assert.rejects(()=>fs.stat(kitchen.stateDir));
  }
});
test('feed-only CLI serves state, prints no token and touches no state directory',async t=>{
  const port=await freePort();
  const kitchen=await spawnKitchen(t,['--feed-only','--project','/logical/root','--port',String(port)],{AGENTTRAIL_FEED_TOKEN:feedToken});
  const base=await kitchen.ready();assert.equal(base,`http://127.0.0.1:${port}`);
  const state=await fetch(base+'/api/state').then(response=>response.json());assert.equal(state.app,'agenttrail-kitchen');assert.equal(state.version,2);
  assert.equal((await fetch(base+'/api/hook',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  kitchen.child.kill('SIGTERM');assert.deepEqual(await kitchen.exited,{code:0,signal:null});
  const {stdout,stderr}=kitchen.output();assert.ok(!(stdout+stderr).includes(feedToken));
  await assert.rejects(()=>fs.stat(kitchen.stateDir));
  assert.deepEqual(await fs.readdir(kitchen.home),[]);
});
