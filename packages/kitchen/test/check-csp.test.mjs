import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';

// A browser that dies on launch and leaves a profile directory nobody can empty. Running as root
// ignores the permission bit, so the cleanup could not fail and the test would prove nothing.
const stubBrowser=`#!${process.execPath}
const fs=require('node:fs');
const profile=process.argv.find(argument=>argument.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
fs.mkdirSync(profile+'/locked',{recursive:true});
fs.writeFileSync(profile+'/locked/lock','');
fs.chmodSync(profile+'/locked',0o555);
`;

test('a profile that cannot be removed does not hide the failure that was found',{skip:process.getuid?.()===0},async()=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'kitchen-csp-test-')),stub=path.join(sandbox,'browser');
  await fs.writeFile(stub,stubBrowser,{mode:0o755});
  try{
    const result=await new Promise(resolve=>execFile(process.execPath,['scripts/check-csp.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,CHROME_BIN:stub,TMPDIR:sandbox}},(error,stdout,stderr)=>resolve({code:error?.code,stderr})));
    assert.equal(result.code,1);
    assert.match(result.stderr,/Chromium exited before answering/);
    assert.match(result.stderr,/Could not remove/);
  }finally{
    for(const entry of await fs.readdir(sandbox,{recursive:true}))await fs.chmod(path.join(sandbox,entry),0o755).catch(()=>{});
    await fs.rm(sandbox,{recursive:true,force:true});
  }
});
