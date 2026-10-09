import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile),read=file=>fs.readFile(new URL('../'+file,import.meta.url));
const buildOutputs=['public/build/app.js','public/fonts/nunito-400.woff2','public/fonts/nunito-600.woff2','public/fonts/nunito-700.woff2','public/fonts/nunito-800.woff2'];
async function buildDigest(){await run(process.execPath,['scripts/build.mjs'],{cwd:new URL('..',import.meta.url)});const hash=createHash('sha256');for(const file of buildOutputs)hash.update(await read(file));return hash.digest('hex');}

test('every build tool and library is pinned to one exact version',async()=>{
  const pkg=JSON.parse(await read('package.json')),lock=JSON.parse(await read('package-lock.json'));
  for(const [name,version] of Object.entries(pkg.devDependencies)){
    assert.match(version,/^\d+\.\d+\.\d+$/,`${name} must not use a version range`);
    assert.equal(lock.packages[''].devDependencies[name],version,`${name} differs in package-lock.json`);
    assert.equal(lock.packages['node_modules/'+name].version,version,`${name} is locked to another version`);
  }
});
test('two builds from the same input are byte-identical',async()=>{assert.equal(await buildDigest(),await buildDigest());});
test('the bundle contains nothing a strict script policy would block',async()=>{
  await buildDigest();
  const bundle=(await read('public/build/app.js')).toString();
  assert.doesNotMatch(bundle,/\beval\s*\(|new\s+Function\s*\(|data:(text|application)\/javascript/);
});
test('the page loads scripts, styles and fonts from this package only',async()=>{
  const page=(await read('public/index.html')).toString(),css=(await read('public/kitchen.css')).toString();
  assert.doesNotMatch(page,/<script(?![^>]*\ssrc=)|\son[a-z]+\s*=|javascript:/i);
  for(const [name,text] of [['index.html',page],['kitchen.css',css]])assert.doesNotMatch(text.replaceAll('http://www.w3.org/2000/svg',''),/https?:\/\/|\/\/[a-z]/i,`${name} reaches outside the package`);
});
