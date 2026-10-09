// Loads the built Kitchen in a headless Chromium, served by the real server with its real
// Content-Security-Policy, with every address except 127.0.0.1 unreachable. Fails on any
// policy violation, script error, outside request, or a scene that did not start.
// Needs `npm run build` first. Set CHROME_BIN to choose the browser.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startOffice} from '../src/server.mjs';

const BROWSERS=['google-chrome','google-chrome-stable','chromium','chromium-browser','chrome'];
const SCENE_TIMEOUT_MS=60_000;

async function launch(profile){
  for(const command of process.env.CHROME_BIN?[process.env.CHROME_BIN]:BROWSERS){
    const child=spawn(command,['--headless','--remote-debugging-pipe','--no-sandbox','--user-data-dir='+profile,'--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','about:blank'],{stdio:['ignore','ignore','inherit','pipe','pipe']});
    const started=await new Promise(resolve=>{child.once('error',()=>resolve(false));child.once('spawn',()=>resolve(true));});
    if(started)return child;
  }
  throw new Error('No Chromium found. Install one or set CHROME_BIN.');
}

function connect(child){
  const [input,output]=[child.stdio[3],child.stdio[4]],pending=new Map(),listeners=[];let nextId=0,buffered='';
  output.on('data',chunk=>{
    buffered+=chunk;
    for(let end;(end=buffered.indexOf('\0'))>=0;){
      const message=JSON.parse(buffered.slice(0,end));buffered=buffered.slice(end+1);
      if(message.id!==undefined){const {resolve,reject}=pending.get(message.id);pending.delete(message.id);message.error?reject(new Error(message.error.message)):resolve(message.result);}
      else listeners.forEach(listener=>listener(message));
    }
  });
  // On Linux the pipes are sockets, and a browser that dies with data unread resets them (ECONNRESET, EPIPE).
  // Unhandled, that error event kills this process before the verdict is printed; the exit handler below reports it.
  input.on('error',()=>{});output.on('error',()=>{});
  // A crashed browser never answers, so fail fast instead of hanging until the CI timeout.
  child.once('exit',()=>pending.forEach(({reject})=>reject(new Error('Chromium exited before answering.'))));
  return {
    send:(method,params={},sessionId)=>new Promise((resolve,reject)=>{if(child.exitCode!==null)return reject(new Error('Chromium exited before answering.'));const id=++nextId;pending.set(id,{resolve,reject});input.write(JSON.stringify({id,method,params,sessionId})+'\0');}),
    on:listener=>listeners.push(listener),
  };
}

const problems=[],home=await fs.mkdtemp(path.join(os.tmpdir(),'kitchen-csp-'));
const office=await startOffice({roots:[path.join(home,'project')],home,stateDir:path.join(home,'state'),port:0,observe:false});
const browser=await launch(path.join(home,'profile'));
try{
  const policy=(await fetch(office.url)).headers.get('content-security-policy')??'';
  if(!/script-src 'self'(;|$)/.test(policy)||/unsafe-eval|script-src[^;]*unsafe-inline/.test(policy))problems.push('Policy does not restrict scripts to self: '+policy);

  const cdp=connect(browser),{targetId}=await cdp.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId,flatten:true});
  const page=(method,params)=>cdp.send(method,params,sessionId);
  const loaded=new Promise(resolve=>cdp.on(({method})=>method==='Page.loadEventFired'&&resolve()));
  cdp.on(({method,params})=>{
    if(method==='Runtime.exceptionThrown')problems.push('Script error: '+(params.exceptionDetails.exception?.description??params.exceptionDetails.text));
    if(method==='Log.entryAdded'&&params.entry.level==='error')problems.push('Browser error: '+params.entry.text);
    if(method==='Network.requestWillBeSent'&&/^(https?|wss?):/.test(params.request.url)&&new URL(params.request.url).origin!==new URL(office.url).origin)problems.push('Request outside the package: '+params.request.url);
    if(method==='Network.loadingFailed')problems.push(`Failed to load ${params.type}: ${params.errorText}`);
  });
  await Promise.all(['Page','Runtime','Network','Log'].map(domain=>page(domain+'.enable')));
  // Injected by the debugger, so it is not itself subject to the policy under test.
  await page('Page.addScriptToEvaluateOnNewDocument',{source:`window.violations=[];addEventListener('securitypolicyviolation',event=>violations.push(event.violatedDirective+' '+event.blockedURI));`});
  await page('Page.navigate',{url:office.url});await loaded;
  const outcome=await page('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`new Promise(resolve=>{
    const timer=setTimeout(()=>resolve({timedOut:true}),${SCENE_TIMEOUT_MS}),loading=document.getElementById('loading');
    const done=()=>{clearTimeout(timer);resolve({notice:document.getElementById('notice').textContent,violations});};
    if(loading.hidden)done();else new MutationObserver(done).observe(loading,{attributes:true,attributeFilter:['hidden']});
  })`});
  const {timedOut,notice,violations=[]}=outcome.result.value;
  if(timedOut)problems.push(`Kitchen was still loading after ${SCENE_TIMEOUT_MS/1000}s.`);
  if(notice?.startsWith('3D graphics could not start'))problems.push('Scene did not start: '+notice);
  problems.push(...violations.map(violation=>'CSP violation: '+violation));
}catch(error){
  problems.push(error.message);
}finally{
  // Wait for exit, and retry: Chromium helper processes can still write to the profile after the main one has gone, which fails removal with ENOTEMPTY.
  // A cleanup failure is only a warning, so it can never hide or flip the verdict below.
  const exited=browser.exitCode===null?new Promise(resolve=>browser.once('exit',resolve)):null;
  browser.kill();await exited;await office.close();
  await fs.rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(error=>console.warn('Could not remove '+home+': '+error.message));
}
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log('Kitchen rendered under script-src \'self\' with no violations and no outside requests.');
