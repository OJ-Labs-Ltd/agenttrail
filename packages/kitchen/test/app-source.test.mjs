import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// app.js has no test that imports it (it needs a browser), so a call left on the old (p,k) signature went unnoticed.
test('every crewForKitchen call in app.js passes crew, project and kitchen',async()=>{
 const source=await fs.readFile(new URL('../public/src/app.js',import.meta.url),'utf8');
 const calls=[...source.matchAll(/crewForKitchen\(((?:[^()]|\(\))*)\)/g)].map(match=>match[1]);
 assert.ok(calls.length>0);
 for(const args of calls)assert.equal(args.split(',').length,3,`crewForKitchen(${args})`);
});
