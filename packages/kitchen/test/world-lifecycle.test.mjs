import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {KitchenWorld} from '../public/src/world.js';

// matchMedia is a browser global; each test installs a counting fake and restores it.
function withMatchMedia(matches,run){
 const original=globalThis.matchMedia,query={matches,added:[],removed:[],addEventListener(type,fn){this.added.push([type,fn]);},removeEventListener(type,fn){this.removed.push([type,fn]);}};
 let reads=0;globalThis.matchMedia=()=>{reads++;return query;};
 try{run(query,()=>reads);}finally{if(original)globalThis.matchMedia=original;else delete globalThis.matchMedia;}
}

test('reducedMotion:true sets reduced without reading matchMedia',()=>{
 withMatchMedia(false,(query,reads)=>{
  const world=Object.create(KitchenWorld.prototype);world.followReducedMotion(true);
  assert.equal(world.reduced,true);assert.equal(reads(),0);assert.deepEqual(query.added,[]);
 });
});

test('reducedMotion:false overrides a media query that asks for reduced motion',()=>{
 withMatchMedia(true,(query,reads)=>{
  const world=Object.create(KitchenWorld.prototype);world.followReducedMotion(false);
  assert.equal(world.reduced,false);assert.equal(reads(),0);
 });
});

test('an omitted reducedMotion option follows the media query, including later changes',()=>{
 withMatchMedia(true,(query,reads)=>{
  const world=Object.create(KitchenWorld.prototype);world.followReducedMotion(undefined);
  assert.equal(world.reduced,true);assert.equal(reads(),1);assert.equal(query.added.length,1);
  query.added[0][1]({matches:false});assert.equal(world.reduced,false);
 });
});

test('destroy stops the loop, disposes GPU resources and removes the media-query listener',()=>{
 withMatchMedia(false,query=>{
  const calls=[],world=Object.create(KitchenWorld.prototype);
  world.followReducedMotion(undefined);
  world.renderer={setAnimationLoop:fn=>calls.push(['loop',fn]),dispose:()=>calls.push(['renderer'])};
  world.composer={dispose:()=>calls.push(['composer'])};
  world.observer={disconnect:()=>calls.push(['observer'])};
  world.room=new T.Group();world.characters=new T.Group();
  const batchGeometry=new T.BufferGeometry();batchGeometry.userData.kitchenBatch=true;
  let geometryDisposed=false;batchGeometry.dispose=()=>{geometryDisposed=true;};
  world.room.add(new T.Mesh(batchGeometry));

  world.destroy();

  assert.deepEqual(calls.map(c=>c[0]).sort(),['composer','loop','observer','renderer']);
  assert.equal(calls.find(c=>c[0]==='loop')[1],null);
  assert.equal(geometryDisposed,true);
  assert.deepEqual(query.removed,query.added);
 });
});
