import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');
const runSteps=yaml=>[...yaml.matchAll(/^\s*- run: (.+)$/gm)].map(m=>m[1].trim());
test('fork checks run every upstream kitchen.yml step',()=>{
 const forkSteps=runSteps(read('.github/workflows/fork-checks.yml'));
 for(const step of runSteps(read('.github/workflows/kitchen.yml'))) assert.ok(forkSteps.includes(step),`fork-checks.yml is missing upstream step: ${step}`);
});
test('fork checks run on every pull request, not only for changed paths',()=>{
 const yaml=read('.github/workflows/fork-checks.yml');
 assert.match(yaml,/^\s*pull_request:\s*$/m);
 assert.doesNotMatch(yaml,/^\s*paths:/m);
});
test('attribution credits upstream and keeps the MIT notice',()=>{
 const attribution=read('ATTRIBUTION.md');
 assert.match(attribution,/sodiumsun\/agenttrail/);
 assert.match(attribution,/MIT/);
 assert.match(attribution,/Kelly Sun/);
});
test('readme lists the fork changes and the upstream sync routine is documented',()=>{
 assert.match(read('README.md'),/## What OJ Labs changed[\s\S]*ATL-7/);
 assert.match(read('docs/UPSTREAM-SYNC.md'),/git fetch upstream[\s\S]*git merge upstream\/main/);
});
