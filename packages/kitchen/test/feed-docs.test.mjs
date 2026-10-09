import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {feedSchema} from '../src/connectors/feed.mjs';

const doc=fs.readFileSync(new URL('../../../docs/kitchen/FEED.md',import.meta.url),'utf8');

// Every key under a `properties` object, at any depth, is a field name a feeder can meet on the wire.
function propertyNames(node,names=new Set()){
  if(Array.isArray(node))node.forEach(child=>propertyNames(child,names));
  else if(node&&typeof node==='object')for(const [key,child] of Object.entries(node)){
    if(key==='properties')Object.keys(child).forEach(name=>names.add(name));
    propertyNames(child,names);
  }
  return names;
}

test('FEED.md names every property in feed.schema.json in backticks',()=>{
  const names=propertyNames(feedSchema),missing=[...names].filter(name=>!doc.includes(`\`${name}\``));
  assert.ok(names.size>100,'expected the schema walk to find the whole contract');
  assert.deepEqual(missing,[],`FEED.md does not document: ${missing.join(', ')}`);
});

test('FEED.md documents every route and the start-up variable',()=>{
  const required=['/api/hook','/api/artifact','/api/bootstrap','/api/state','/api/events','AGENTTRAIL_FEED_TOKEN','--feed-only'];
  assert.deepEqual(required.filter(item=>!doc.includes(item)),[]);
});
