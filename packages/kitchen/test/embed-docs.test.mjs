import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseEmbedParams} from '../public/embed-page.js';
import {evidenceDetail} from '../public/src/embed-list.js';

const root=new URL('../../../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const embedding=read('docs/kitchen/EMBEDDING.md'),observability=read('docs/OBSERVABILITY.md');
const embedSection=observability.match(/## Embedded Kitchen[\s\S]*?(?=\n## |$)/)?.[0]||'';

// The names a host can meet: mountKitchen's options, the iframe's query parameters and the evidence event's detail.
const mountOptions=read('packages/kitchen/public/src/embed.js').match(/export function mountKitchen\(element,\{([^}]*)\}/)[1].split(',').map(part=>part.split('=')[0].trim());
const queryParameters=['snapshotUrl','eventsUrl','token','theme','reducedMotion','parentOrigin'];
const detailFields=Object.keys(evidenceDetail({id:'a',label:'l',kind:'k',revisionId:'r'},{id:'o'}));
const undocumented=names=>names.filter(name=>!embedding.includes(`\`${name}\``));

test('EMBEDDING.md names every mountKitchen option in backticks',()=>{
  assert.deepEqual(mountOptions,['snapshotUrl','eventsUrl','token','theme','reducedMotion']);
  assert.deepEqual(undocumented(mountOptions),[]);
});

test('EMBEDDING.md names every query parameter the embed page reads',()=>{
  const values={snapshotUrl:'https://feed.example/snapshot',eventsUrl:'https://feed.example/events',parentOrigin:'https://host.example'};
  const parsed=parseEmbedParams(`?${queryParameters.map(name=>`${name}=${encodeURIComponent(values[name]??'true')}`).join('&')}`);
  assert.deepEqual(Object.keys(parsed).sort(),[...queryParameters].sort());
  assert.deepEqual(undocumented(queryParameters),[]);
});

test('EMBEDDING.md documents the evidence event and its five detail fields',()=>{
  assert.equal(detailFields.length,5);
  assert.deepEqual(undocumented(detailFields),[]);
  assert.ok(embedding.includes('`agenttrail-kitchen:evidence`'));
});

test('EMBEDDING.md states the token limit, the scoped short-lived advice and the import path',()=>{
  assert.match(embedding,/query string/i);
  assert.match(embedding,/short-lived/);
  assert.ok(embedding.includes('agenttrail-kitchen/public/build/embed.js'));
});

test('OBSERVABILITY.md has an embed section saying what is fetched and what the host receives',()=>{
  assert.match(embedSection,/snapshotUrl/);
  assert.match(embedSection,/eventsUrl/);
  assert.match(embedSection,/no telemetry/i);
  for(const field of detailFields)assert.ok(embedSection.includes(`\`${field}\``),`${field} missing from the embed section`);
});

test('the embed docs carry no machine path, Plane URL, job id or secret',()=>{
  for(const text of [embedding,embedSection]){
    assert.doesNotMatch(text,/\/Users\/|\/home\/|C:\\|:9999|\/issues\/|\bjob [0-9a-f]{12,}/i);
    assert.doesNotMatch(text,/Bearer [A-Za-z0-9_-]{16,}/);
  }
});

test('the embed docs use British spelling',()=>{
  // `Authorization` is the HTTP header's own name, so it is the one American spelling that must stay.
  for(const text of [embedding,embedSection])assert.doesNotMatch(text.replaceAll('Authorization',''),/\b(behavior|authoriz|color|initializ|customiz|organiz)\w*/i);
});

test('the README lists ATL-6 and the package readme links the embedding guide',()=>{
  assert.match(read('README.md'),/## What OJ Labs changed[\s\S]*\| ATL-6 \|/);
  assert.match(read('packages/kitchen/README.md'),/EMBEDDING\.md/);
});

test('PLAN.md records the embedding work as finished tasks under the Kitchen component and adds no component',()=>{
  const plan=read('PLAN.md'),kitchen=plan.match(/## Show agents cooking together \{#kitchen\}[\s\S]*?(?=\n## )/)[0];
  assert.match(kitchen,/- \[x\] .*\{#kitchen-embed[\w-]*\}\n\s+by: claude/);
  assert.equal([...plan.matchAll(/^## .*\{#[\w-]+\}$/gm)].length,8);
});
