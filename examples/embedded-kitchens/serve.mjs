// Static server for the embedded-kitchens demo: loopback only, read-only, and nothing outside the two folders below.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const demoRoot=path.dirname(fileURLToPath(import.meta.url));
const buildRoot=path.resolve(demoRoot,'../../packages/kitchen/public/build');
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json'};

export function createDemoServer(){
  return http.createServer(async(request,response)=>{
    try{
      const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
      const [root,name]=pathname.startsWith('/build/')?[buildRoot,pathname.slice('/build/'.length)]:[demoRoot,pathname==='/'?'index.html':pathname.slice(1)];
      const file=path.resolve(root,name);
      if(!file.startsWith(root+path.sep))throw new Error('outside the served folders');
      // Read before writing the head, so a missing file can still answer 404.
      const body=await fs.readFile(file);
      response.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'"});
      response.end(body);
    }catch{
      response.writeHead(404).end('Not found');
    }
  });
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  createDemoServer().listen(4790,'127.0.0.1',()=>console.log('Embedded kitchens demo on http://127.0.0.1:4790'));
}
