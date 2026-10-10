import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startOffice} from '../src/server.mjs';
import {parseEmbedParams} from '../public/embed-page.js';

async function start(t){
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'orbit-embed-')),root=path.join(home,'project');await fs.mkdir(root);
  const office=await startOffice({roots:[root],home,stateDir:path.join(home,'state'),port:0});
  t.after(async()=>{await office.close();await fs.rm(home,{recursive:true,force:true});});
  assert.match(office.url,/^http:\/\/127\.0\.0\.1:\d+$/);
  return office;
}

test('only the embed page may be framed, and only by the same origin',async t=>{
  const office=await start(t);
  const embed=await fetch(office.url+'/embed.html');
  assert.equal(embed.status,200);
  assert.equal(embed.headers.get('content-type').split(';')[0],'text/html');
  assert.match(embed.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.doesNotMatch(embed.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  for(const other of ['/','/embed-page.js','/build/embed.js']){
    const response=await fetch(office.url+other);
    assert.equal(response.status,200,other);
    assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/,other);
  }
});

test('the query string decides the options, with the token and a safe theme',()=>{
  const options=parseEmbedParams('?snapshotUrl=https://host.test/snap&eventsUrl=https://host.test/ev&token=abc&theme=dark&reducedMotion=true&parentOrigin=https://host.test');
  assert.deepEqual(options,{snapshotUrl:'https://host.test/snap',eventsUrl:'https://host.test/ev',token:'abc',theme:'dark',reducedMotion:true,parentOrigin:'https://host.test'});
  assert.equal(parseEmbedParams('?snapshotUrl=https://host.test/snap&token=abc&theme=neon').theme,'light');
  assert.equal(parseEmbedParams('?snapshotUrl=https://host.test/snap&token=abc').reducedMotion,undefined);
  assert.equal(parseEmbedParams('?snapshotUrl=https://host.test/snap&token=abc&reducedMotion=false').reducedMotion,false);
});

test('a snapshot or events URL that is not http(s) is rejected',()=>{
  for(const bad of ['javascript:alert(1)','file:///etc/passwd','data:text/plain,x','not a url'])
    assert.throws(()=>parseEmbedParams('?token=abc&snapshotUrl='+encodeURIComponent(bad)),/snapshotUrl/,bad);
  assert.throws(()=>parseEmbedParams('?token=abc'),/snapshotUrl/);
  assert.throws(()=>parseEmbedParams('?token=abc&snapshotUrl=https://host.test/s&eventsUrl=ftp://host.test/e'),/eventsUrl/);
});

test('a missing snapshotUrl throws when a page location exists',t=>{
  globalThis.location={href:'https://host.test/embed.html'};t.after(()=>{delete globalThis.location;});
  assert.throws(()=>parseEmbedParams('?token=abc'),/snapshotUrl must be an http\(s\) URL/);
  assert.throws(()=>parseEmbedParams('?token=abc&snapshotUrl='),/snapshotUrl must be an http\(s\) URL/);
});

test('the token is required and never appears in an error',()=>{
  assert.throws(()=>parseEmbedParams('?snapshotUrl=https://host.test/s'),/token/);
  assert.throws(()=>parseEmbedParams('?token=secret-value&snapshotUrl=ftp://x'),error=>!/secret-value/.test(error.message));
});

test('a parent origin that is not a bare http(s) origin gives no message target',()=>{
  for(const bad of ['*','null','https://host.test/path','https://host.test/','javascript:alert(1)','host.test','https://user@host.test',''])
    assert.equal(parseEmbedParams('?token=abc&snapshotUrl=https://host.test/s&parentOrigin='+encodeURIComponent(bad)).parentOrigin,null,bad);
  assert.equal(parseEmbedParams('?token=abc&snapshotUrl=https://host.test/s').parentOrigin,null);
  assert.equal(parseEmbedParams('?token=abc&snapshotUrl=https://host.test/s&parentOrigin=http://127.0.0.1:3000').parentOrigin,'http://127.0.0.1:3000');
});
