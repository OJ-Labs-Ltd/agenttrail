import test from 'node:test';
import assert from 'node:assert/strict';
import {connectFeed} from '../public/src/embed-feed.js';

const TOKEN='tok-invented-0123456789';
const SNAPSHOT_URL='http://127.0.0.1:4100/api/state';
const EVENTS_URL='http://127.0.0.1:4100/api/events';
const encoder=new TextEncoder();
// Timers are faked and promise queues drained with setImmediate, so no test waits on the wall clock.
const settle=()=>new Promise(resolve=>setImmediate(resolve));

function streamOf(chunks,{hang=false,signal}={}){
  return new ReadableStream({start(controller){
    for(const chunk of chunks)controller.enqueue(encoder.encode(chunk));
    if(!hang)controller.close();
    else signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')));
  }});
}
const json=body=>new Response(JSON.stringify(body),{status:200});

// Serves each queued responder once; records every request so tests can check URLs, headers and signals.
function stubFetch(t,...responders){
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    calls.push({url:String(url),headers:new Headers(init?.headers),signal:init?.signal});
    return responders[calls.length-1](init);
  });
  return calls;
}
function collect(overrides={}){
  const seen={snapshots:[],statuses:[]};
  const options={snapshotUrl:SNAPSHOT_URL,eventsUrl:EVENTS_URL,token:TOKEN,onSnapshot:s=>seen.snapshots.push(s),onStatus:s=>seen.statuses.push(s),...overrides};
  return {seen,options};
}

test('connectFeed rejects non-http(s) URLs before any request is made',t=>{
  const calls=stubFetch(t);
  for(const bad of ['javascript:alert(1)','data:text/plain,hi','file:///etc/passwd']){
    assert.throws(()=>connectFeed(collect({snapshotUrl:bad}).options),/snapshotUrl must be an http\(s\) URL/);
    assert.throws(()=>connectFeed(collect({eventsUrl:bad}).options),/eventsUrl must be an http\(s\) URL/);
  }
  assert.equal(calls.length,0);
});

// In a browser `location` exists, so new URL(null,base) resolves to <origin>/null instead of throwing; Node has no location, which hid this.
test('a missing or empty URL throws when a page location exists',t=>{
  const calls=stubFetch(t);
  globalThis.location={href:'https://host.test/page'};t.after(()=>{delete globalThis.location;});
  for(const missing of [undefined,null,''])
    assert.throws(()=>connectFeed(collect({snapshotUrl:missing}).options),/snapshotUrl must be an http\(s\) URL/);
  assert.equal(calls.length,0);
});

test('connectFeed requires a token',t=>{
  stubFetch(t);
  assert.throws(()=>connectFeed(collect({token:''}).options),/token is required/);
});

test('without eventsUrl the snapshot is read once, with the token in a header only',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=stubFetch(t,()=>json({crew:[]}));
  const {seen,options}=collect({eventsUrl:undefined});
  connectFeed(options);
  await settle();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,SNAPSHOT_URL);
  assert.equal(calls[0].headers.get('authorization'),`Bearer ${TOKEN}`);
  assert.deepEqual(seen.snapshots,[{crew:[]}]);
  assert.deepEqual(seen.statuses,['live']);
});

test('SSE frames split mid-line across reads each yield one snapshot; comments are ignored',async t=>{
  const calls=stubFetch(t,()=>json({n:0}),()=>new Response(streamOf([
    ': heartbeat\n\ndata: {"n":',
    '1}\n\nda','ta: {"n":2}\r\n\r\n: another\n',
    '\ndata: {"n":3}\n\n'
  ],{hang:true}),{status:200}));
  const {seen,options}=collect();
  const feed=connectFeed(options);
  await settle();await settle();
  assert.deepEqual(seen.snapshots,[{n:0},{n:1},{n:2},{n:3}]);
  for(const call of calls){
    assert.equal(call.headers.get('authorization'),`Bearer ${TOKEN}`);
    assert.ok(!call.url.includes(TOKEN));
  }
  feed.close();
});

test('a 401 reports offline, schedules one retry and never echoes the token',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=stubFetch(t,()=>new Response('nope',{status:401}),()=>json({n:1}),()=>new Response(streamOf([]),{status:200}));
  const {seen,options}=collect();
  connectFeed(options);
  await settle();
  assert.deepEqual(seen.statuses,['offline']);
  assert.equal(calls.length,1);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(calls.length,3);
  assert.deepEqual(seen.snapshots,[{n:1}]);
  assert.ok(!JSON.stringify(seen).includes(TOKEN));
});

test('a fetch failure whose message contains the token is reported as plain offline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  stubFetch(t,()=>{throw new TypeError(`bad header ${TOKEN}`);});
  const {seen,options}=collect();
  connectFeed(options);
  await settle();
  assert.deepEqual(seen.statuses,['offline']);
});

test('a dropped stream reports offline and retries after the delay',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=stubFetch(t,()=>json({n:0}),()=>new Response(streamOf(['data: {"n":1}\n\n']),{status:200}),()=>json({n:2}),()=>new Response(streamOf([],{hang:true}),{status:200}));
  const {seen,options}=collect();
  connectFeed(options);
  await settle();await settle();
  assert.deepEqual(seen.statuses,['live','offline']);
  assert.equal(calls.length,2);
  t.mock.timers.tick(5000);
  await settle();await settle();
  assert.equal(calls.length,4);
  assert.deepEqual(seen.snapshots,[{n:0},{n:1},{n:2}]);
});

test('close cancels a pending retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=stubFetch(t,()=>new Response('x',{status:500}));
  const {options}=collect();
  const feed=connectFeed(options);
  await settle();
  feed.close();
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls.length,1);
});

test('close aborts the in-flight stream and no retry fires afterwards',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const calls=stubFetch(t,()=>json({n:1}),init=>new Response(streamOf([],{hang:true,signal:init.signal}),{status:200}));
  const {seen,options}=collect();
  const feed=connectFeed(options);
  await settle();await settle();
  assert.equal(calls.length,2);
  feed.close();
  await settle();
  assert.equal(calls[1].signal.aborted,true);
  t.mock.timers.tick(60000);
  await settle();
  assert.equal(calls.length,2);
  assert.deepEqual(seen.statuses,['live']);
});

test('a malformed JSON frame is reported and the stream keeps going',async t=>{
  stubFetch(t,()=>json({n:0}),()=>new Response(streamOf(['data: {oops\n\ndata: {"n":2}\n\n'],{hang:true}),{status:200}));
  const {seen,options}=collect();
  const feed=connectFeed(options);
  await settle();await settle();
  assert.deepEqual(seen.statuses,['live','malformed']);
  assert.deepEqual(seen.snapshots,[{n:0},{n:2}]);
  feed.close();
});
