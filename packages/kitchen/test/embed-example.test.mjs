import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {scrubSnapshot} from '../src/runtime/payload-allowlist.mjs';
import {listModel} from '../public/src/embed-list.js';
import {createDemoServer} from '../../../examples/embedded-kitchens/serve.mjs';

const folder=new URL('../../../examples/embedded-kitchens/',import.meta.url);
const read=async name=>JSON.parse(await fs.readFile(new URL(name,folder),'utf8'));
const [a,b]=await Promise.all([read('snapshot-a.json'),read('snapshot-b.json')]);

test('the fixtures are what a real browser would receive: scrubbing changes nothing',()=>{
 for(const fixture of [a,b])assert.deepEqual(scrubSnapshot(fixture,{roots:['/work/project'],home:'/home/me'}),fixture);
});

test('each fixture lists chefs and tickets, and the two kitchens differ',()=>{
 const [listA,listB]=[a,b].map(fixture=>listModel(fixture,fixture.projects[0].id));
 for(const list of [listA,listB]){assert.ok(list.chefs.length>0);assert.ok(list.tickets.length>0);}
 assert.notDeepEqual(listA,listB);
});

test('the fixtures hold no absolute path, home directory or token-like string',async()=>{
 for(const name of ['snapshot-a.json','snapshot-b.json']){
  const text=await fs.readFile(new URL(name,folder),'utf8');
  assert.doesNotMatch(text,/(^|["\s:])\/[\w.-]+\/|[A-Za-z]:\\|~\/|\/Users\/|\/home\//,name);
  assert.doesNotMatch(text,/sk-|ghp_|Bearer|eyJ|[A-Za-z0-9+/_-]{32,}/,name);
 }
});

test('the demo page has no inline script and no external URL',async()=>{
 const page=await fs.readFile(new URL('index.html',folder),'utf8');
 assert.doesNotMatch(page,/<script(?![^>]*\ssrc=)/i);
 assert.doesNotMatch(page,/(https?:)?\/\/[\w.-]+\.[a-z]{2,}/i);
});

function get(port,path){
 return new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path},response=>{response.resume();resolve(response);}).on('error',reject));
}

test('the demo server binds loopback, serves the demo, a fixture and the build, and refuses traversal',async t=>{
 const server=createDemoServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.close();server.closeAllConnections();});
 assert.equal(server.address().address,'127.0.0.1');
 const {port}=server.address();
 for(const path of ['/','/demo.js','/snapshot-a.json','/build/embed.js'])assert.equal((await get(port,path)).statusCode,200,path);
 for(const path of ['/build/../../../package.json','/..%2f..%2f..%2fpackage.json','/build/%2e%2e/%2e%2e/package.json','/nothing.html'])assert.equal((await get(port,path)).statusCode,404,path);
});
