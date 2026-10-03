import assert from 'node:assert/strict';
import { initialPiece, buildWorld, splitPiece, transferPieceMotion } from '../src/pieces.js';
import { SoftBody } from '../src/physics.js';
import { itemScale, makeStack, poseStack, stackPositions, stackPreview, buildSkewer, skewerRayDistance } from '../src/stack.js';
import { buildSmoothSkin, skinSmooth } from '../src/smooth-skin.js';
import { drawOfflineBear, hitTestMap } from '../src/offline-preview.js';
import { PALETTES } from '../src/palettes.js';

const pieces=['pear','cucumber','orange','bear','watermelon'].map((type,i)=>initialPiece(type,[i*3.4,0],'amber'));
const world=buildWorld(pieces), sim=new SoftBody(world.sim,{firmness:.5,damping:.4});
for(let v=0;v<world.render.mat.length;v++) {
  const piece=pieces[world.render.vComp[v]],s=itemScale(piece),[ox,oz]=piece.offset;
  const original=world.render.materialRest;
  assert.ok(Math.abs(world.render.rest[3*v]-(ox+(original[3*v]-ox)*s))<2e-6);
  assert.ok(Math.abs(world.render.rest[3*v+1]-original[3*v+1]*s)<2e-6);
  assert.ok(Math.abs(world.render.rest[3*v+2]-(oz+(original[3*v+2]-oz)*s))<2e-6);
}
const width=c=>{
  let lo=Infinity,hi=-Infinity;
  for(let i=0;i<sim.n;i++) if(sim.comp[i]===c) { lo=Math.min(lo,sim.rest[3*i]);hi=Math.max(hi,sim.rest[3*i]); }
  return hi-lo;
};
assert.ok(width(1)<width(0),'cucumber is visibly smaller than pear');
assert.equal(itemScale(pieces[0]),1,'pear geometry is unchanged');

const stack=makeStack(sim);poseStack(sim,stack);
const posed=stackPositions(world.render,stack);
const skin=buildSmoothSkin(sim,world.render,world.skinIdx,world.skinW);
const skinned=new Float64Array(posed.length);
skinSmooth(skin,sim.rest,sim.x,world.render.rest,skinned,3);
let discrepancy=0;
for(let i=0;i<posed.length;i++) discrepancy=Math.max(discrepancy,Math.abs(posed[i]-skinned[i]));
assert.ok(discrepancy<3e-6,'software pose matches affine live skinning');
for(const layer of stack.layers) {
  assert.ok(layer.anchors.length>=4,'rod grips a volume rather than a lone vertex');
  for(const i of layer.anchors) assert.ok(Math.hypot(sim.x[3*i],sim.x[3*i+2])<.221);
}
for(let f=0;f<150;f++) sim.step();
assert.ok(Math.abs(sim.volumeRatio()-1)<.03);
assert.ok(sim.minVolumeRatio()>.2,'no inverted or collapsed tets in the stack');
const extrema=[];
for(let c=0;c<sim.nComp;c++) {
  let min=Infinity,max=-Infinity,anchorError=0;
  for(let i=0;i<sim.n;i++) if(sim.comp[i]===c) {
    min=Math.min(min,sim.x[3*i+1]);max=Math.max(max,sim.x[3*i+1]);
  }
  for(const i of stack.layers[c].anchors) for(let k=0;k<3;k++) anchorError=Math.max(anchorError,Math.abs(sim.x[3*i+k]-sim.rest[3*i+k]-stack.layers[c].shift[k]));
  assert.ok(anchorError<.003,'central pierced patch stays on the rod');
  if(c) assert.ok(min>=extrema[c-1][1]-1e-5,'slices cannot pass through one another');
  extrema.push([min,max]);
}
// Peripheral movement remains possible; the skewer is not a frozen-object pose.
const tip=Array.from(sim.comp,(c,i)=>c===2?i:-1).filter(i=>i>=0).sort((a,b)=>sim.x[3*b]-sim.x[3*a])[0];
const hit=Array.from(sim.x.slice(3*tip,3*tip+3));
sim.beginGrab(hit,.24);sim.moveGrab([hit[0]+.12,hit[1]+.04,hit[2]]);
for(let f=0;f<12;f++) sim.step();
assert.ok(sim.x[3*tip]>hit[0]+.015,'outer jelly can still be pulled');
sim.endGrab();
sim.skewer=null;
const before=sim.x[3*stack.layers.at(-1).anchors[0]+1];
for(let f=0;f<30;f++) sim.step();
assert.ok(sim.x[3*stack.layers.at(-1).anchors[0]+1]<before-.05,'removing rod releases the bodies');

// Scaling remains compatible with cut interpolation and material coordinates.
const cucumber=pieces[1],parts=splitPiece(cucumber.I,1,0,cucumber.offset[0]);
assert.equal(parts.length,2);
const cutPieces=parts.map(I=>({...cucumber,I,cache:null}));
const oldWorld=buildWorld([cucumber]),oldSim=new SoftBody(oldWorld.sim);
for(let i=0;i<oldSim.n;i++) {oldSim.x[3*i+1]+=.2;oldSim.v[3*i]=.3;}
const cutWorld=buildWorld(cutPieces),cutSim=new SoftBody(cutWorld.sim);
transferPieceMotion(oldSim,cutSim,[cucumber],cutPieces);
for(let i=0;i<cutSim.n;i++) {
  assert.ok(Math.abs(cutSim.x[3*i+1]-cutSim.rest[3*i+1]-.2)<1e-5);
  assert.ok(Math.abs(cutSim.v[3*i]-.3)<1e-5);
}
const cutStack=makeStack(cutSim);poseStack(cutSim,cutStack);
assert.equal(cutStack.layers.length,2,'each existing cut fragment is threaded');

// The fallback draws a real depth-tested prop; it cannot steal candy picking.
let image;
const context={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:im=>{image=im;}};
const canvas={width:0,height:0,getContext:()=>context,getBoundingClientRect:()=>({width:360,height:420})};
const preview=stackPreview(world.render,stack,buildSkewer(stack.height));
drawOfflineBear(canvas,preview,PALETTES.amber,'side',{az:Math.PI/2,el:.3,zoom:1});
const map=canvas.__hitMap;
assert.ok(image.data.some(v=>v!==0));
let rodPixels=0;
for(let i=0;i<map.buf.length;i++) {
  const c=map.buf[i];assert.ok(c<5,'prop never reports a candy component');
  if(c===-2) {
    rodPixels++;
    assert.equal(hitTestMap(map,(i%map.width)/map.sx,Math.floor(i/map.width)/map.sy,14),-1);
  }
}
assert.ok(rodPixels>10,'wooden tip/gaps visibly render');
assert.ok(preview.props.count<300,'toothpick remains a lightweight mesh');
assert.ok(skewerRayDistance({o:[0,stack.height-.4,2],d:[0,0,-1]},buildSkewer(stack.height))<2,'live ray hits the actual rod');
assert.equal(skewerRayDistance({o:[2,stack.height-.4,2],d:[0,0,-1]},buildSkewer(stack.height)),Infinity);
assert.equal(stackPreview(world.render,null,null),world.render,'unstack removes the rod in preview');
console.log('stack: sizes, material mapping, stable layers, elastic grip, cut transfer, rod visibility and picking passed', {rodPixels,discrepancy});