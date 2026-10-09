import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startOffice} from '../src/server.mjs';
import {validateFeed} from '../src/connectors/feed.mjs';

const feedToken='feed-token-0123456789abcdef';
const packagePublic=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','public');
// Feed-only never creates or reads the project, so a logical root that does not exist on disk is enough.
const root='/orbit-feed-fixture/project';
const readers=['readFile','readdir','stat','lstat','realpath','open','access','watch','createReadStream','readFileSync','readdirSync','statSync','lstatSync','realpathSync','openSync','accessSync','existsSync','opendirSync','opendir'];

// Wraps every read-side function on both fs modules; returns the paths seen and a restore function.
function recordFsReads(){
  const seen=[],originals=[];
  for(const target of [fs,fsp])for(const name of readers){
    const original=target[name];if(typeof original!=='function')continue;
    originals.push([target,name,original]);
    target[name]=function(...args){if(args[0]!==undefined&&!(typeof args[0]==='number'))seen.push(String(args[0]));return original.apply(this,args);};
  }
  return {seen,restore(){for(const [target,name,original] of originals)target[name]=original;}};
}

// Reads the SSE stream one `data:` message at a time, waiting on the stream itself and never on a timer.
async function openStream(url){
  const response=await fetch(url),reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  return {
    async next(){
      for(;;){
        const end=buffer.indexOf('\n\n');
        if(end>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const line=block.split('\n').find(l=>l.startsWith('data: '));if(line)return JSON.parse(line.slice(6));continue;}
        const {value,done}=await reader.read();assert.ok(!done,'event stream ended early');buffer+=decoder.decode(value,{stream:true});
      }
    },
    close:()=>reader.cancel()
  };
}

const hook=(id,event,provider='claude',sessionId='session-a')=>({id,provider,sessionId,cwd:root,...event});
const artifact=(id,event)=>({id,artifactId:'report',revisionId:'revision-1',provider:'claude',sessionId:'session-a',cwd:root,...event});
const script=[
  ['session-start',hook('e1',{kind:'session-start'}),s=>s.state==='working'&&!s.ended],
  ['turn-start',hook('e2',{kind:'turn-start',turnId:'turn-1'}),s=>s.state==='working'&&s.turnId==='turn-1'],
  ['tool-start Write',hook('e3',{kind:'tool-start',turnId:'turn-1',tool:'Write',toolId:'tool-1',file:`${root}/main.js`}),s=>s.state==='writing'&&s.tool==='Write'&&s.file==='main.js'],
  ['TodoWrite tasks',hook('e4',{kind:'tool-start',turnId:'turn-1',tool:'TodoWrite',toolId:'tool-2',tasks:[{id:'t1',title:'Invented task',status:'in_progress'}]}),(s,all)=>s.tool==='TodoWrite'&&all.orders.some(order=>order.title==='Invented task'&&order.status==='in_progress')],
  ['tool-end',hook('e5',{kind:'tool-end',turnId:'turn-1',tool:'Write',toolId:'tool-1'}),s=>s.state==='working'],
  ['permission',hook('e6',{kind:'permission',turnId:'turn-1'}),s=>s.state==='permission'],
  ['turn-end',hook('e7',{kind:'turn-end',turnId:'turn-1'}),s=>s.state==='complete'],
  ['session-end',hook('e8',{kind:'session-end'}),s=>s.state==='offline'&&s.ended]
];

test('feed-only scripted events give schema-valid state and stream, and read nothing outside the package',async t=>{
  const recorder=recordFsReads();
  t.after(recorder.restore);
  const office=await startOffice({roots:[root],home:'/orbit-feed-fixture/home',stateDir:'/orbit-feed-fixture/state',port:0,feedOnly:true,feedToken});
  const get=url=>fetch(office.url+url);
  const post=(url,body,token=feedToken)=>fetch(office.url+url,{method:'POST',headers:{...(token?{authorization:`Bearer ${token}`}:{}),'content-type':'application/json'},body:JSON.stringify(body)});
  const stream=await openStream(office.url+'/api/events');
  t.after(async()=>{await stream.close();});
  const assertValid=snapshot=>assert.deepEqual(validateFeed('snapshot',snapshot),[]);
  // Every accepted event changes the snapshot, so exactly one message follows; the POST has already ticked.
  async function push(label,url,body,check){
    const accepted=await post(url,body).then(r=>r.json());assert.equal(accepted.accepted,true,label);
    const [streamed,fetched]=[await stream.next(),await get('/api/state').then(r=>r.json())];
    for(const snapshot of [streamed,fetched]){assertValid(snapshot);check(snapshot);}
  }

  const boot=await get('/api/bootstrap').then(r=>r.json());assertValid(boot);assert.ok(!('token' in boot));
  const first=await stream.next();assertValid(first);assert.deepEqual(first.executors,[]);

  for(const [label,body,check] of script)await push(label,'/api/hook',body,snapshot=>assert.ok(check(snapshot.executors[0],snapshot),label));
  assert.equal((await get('/')).status,200);

  await push('artifact produced','/api/artifact',artifact('a1',{kind:'produced',type:'json',file:'report.json'}),s=>{assert.equal(s.artifacts.length,1);assert.equal(s.artifacts[0].file,'report.json');assert.equal(s.transfers.length,0);});
  const handoff={handoffId:'handoff-1',recipientProvider:'cursor',recipientSessionId:'session-b'};
  await push('artifact offered','/api/artifact',artifact('a2',{kind:'offered',...handoff}),s=>assert.deepEqual([s.transfers.length,s.transfers[0].state],[1,'offered']));
  await push('artifact received','/api/artifact',artifact('a3',{kind:'received',...handoff}),s=>assert.deepEqual([s.transfers.length,s.transfers[0].state],[1,'received']));

  // Refusals change nothing, so no stream message follows them.
  const before=await get('/api/state').then(r=>r.json());
  assert.equal((await post('/api/hook',hook('e9',{kind:'activity'}),null)).status,403);
  assert.equal((await post('/api/hook',hook('e9',{kind:'activity'}),'wrong-token-0123456789')).status,403);
  assert.equal((await post('/api/hook',hook('e9',{kind:'activity',arguments:'invented'}))).status,400);
  assert.equal((await post('/api/hook',{...hook('e9',{kind:'activity'}),cwd:'/elsewhere/project'}).then(r=>r.json())).accepted,false);
  assert.deepEqual(await get('/api/state').then(r=>r.json()),before);
  for(const url of ['/api/attach','/api/projects','/api/setup/preview','/api/setup/apply'])assert.ok([404,405].includes((await post(url,{})).status),url);

  await stream.close();await office.close();
  recorder.restore();
  assert.ok(recorder.seen.length>0,'the spy should at least see the static page read');
  const outside=recorder.seen.filter(file=>!path.resolve(file).startsWith(packagePublic+path.sep));
  assert.deepEqual(outside,[]);
});
