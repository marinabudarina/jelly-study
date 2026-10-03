import assert from 'node:assert/strict';
import { buildWorld, initialPiece, splitPiece } from '../src/pieces.js';
import { embed } from '../src/geometry.js';
import { SoftBody } from '../src/physics.js';
import { buildSmoothSkin, skinSmooth } from '../src/smooth-skin.js';

function barycentric(world, positions, render = world.render, emb = null) {
  const out = new Float64Array(render.rest.length);
  for (let v=0;v<out.length/3;v++) for (let j=0;j<4;j++) {
    const id = emb ? world.sim.tets[4*emb.tetOf[v]+j] : world.skinIdx[4*v+j];
    const w = emb ? emb.w[4*v+j] : world.skinW[4*v+j];
    for (let k=0;k<3;k++) out[3*v+k] += positions[3*id+k]*w;
  }
  return out;
}
function curvature(positions, rest) {
  let peak = 0, square = 0;
  for (let v=1;v<positions.length/3-1;v++) {
    let q=0;
    for (let k=0;k<3;k++) {
      const d = positions[3*(v-1)+k]-rest[3*(v-1)+k] -
        2*(positions[3*v+k]-rest[3*v+k]) + positions[3*(v+1)+k]-rest[3*(v+1)+k];
      q += d*d;
    }
    peak = Math.max(peak,Math.sqrt(q)); square += q;
  }
  return {peak,rms:Math.sqrt(square/(positions.length/3-2))};
}

for (const type of ['bear','orange','watermelon']) {
  const start = performance.now(), world = buildWorld([initialPiece(type)]), sim = new SoftBody(world.sim);
  const skinStart = performance.now();
  const skin = buildSmoothSkin(sim,world.render,world.skinIdx,world.skinW);
  const skinSetupMs = performance.now()-skinStart;
  const out = new Float64Array(world.render.rest.length);
  skinSmooth(skin,sim.rest,sim.rest,world.render.rest,out,3);
  assert.deepEqual(out,Float64Array.from(world.render.rest),'zero deformation must preserve every molded vertex/seed exactly');
  const transformed = Float64Array.from(sim.rest, (x,i) => {
    const v=3*Math.floor(i/3), k=i%3;
    return [[1.02,.06,0],[.02,.96,-.04],[0,.05,1.03]][k].reduce((s,a,j)=>s+a*sim.rest[v+j], [1,.4,-.3][k]);
  });
  skinSmooth(skin,sim.rest,transformed,world.render.rest,out,3);
  let affineError=0;
  for (let i=0;i<out.length;i++) {
    const v=3*Math.floor(i/3), k=i%3;
    const expected = [[1.02,.06,0],[.02,.96,-.04],[0,.05,1.03]][k].reduce((s,a,j)=>s+a*world.render.rest[v+j],[1,.4,-.3][k]);
    affineError = Math.max(affineError,Math.abs(out[i]-expected));
  }
  assert.ok(affineError < 1e-6,'rotation, translation and affine stretch must be reproduced, not blurred');
  sim.gravity=0; sim.floorY=-10;
  let nearest=0,best=Infinity;
  for(let i=0;i<sim.n;i++) {
    const d=Math.hypot(sim.x[3*i]-.32,sim.x[3*i+1]-1,sim.x[3*i+2]+.1);
    if(d<best){best=d;nearest=i;}
  }
  const hit=Array.from(sim.x.slice(3*nearest,3*nearest+3));
  sim.beginGrab(hit,.4);
  sim.moveGrab([hit[0]+.05,hit[1]+.025,hit[2]]);
  sim.step();
  assert.ok(sim.grabTarget[0]>hit[0]+.04 && sim.grabTarget[0]<hit[0]+.05,
    'reconstruct pointer steps without overshoot or more than one frame of input delay');
  for(let f=1;f<10;f++) sim.step();
  assert.ok(Math.abs(sim.volumeRatio()-1)<.03 && sim.minVolumeRatio()>0,'tiny pull retains volume and oriented tets');
  // A finely sampled line through the pulled region separates true broad bend
  // from derivative jumps at the hidden tetrahedral boundaries.
  const line=[];
  for(let j=0;j<101;j++) line.push(-.4+j*.008,hit[1],-.1);
  const probe={rest:new Float32Array(line),vComp:new Uint16Array(101)};
  const emb=embed(sim.rest,sim.tets,probe.rest), ids=new Uint32Array(404);
  for(let v=0;v<101;v++) for(let j=0;j<4;j++) ids[4*v+j]=sim.tets[4*emb.tetOf[v]+j];
  const fit=buildSmoothSkin(sim,probe,ids,emb.w), smooth=new Float64Array(line.length);
  skinSmooth(fit,sim.rest,sim.x,probe.rest,smooth,3);
  const legacy=barycentric(world,sim.x,probe,emb);
  const before=curvature(legacy,probe.rest), after=curvature(smooth,probe.rest);
  const displacement=p=>Math.max(...Array.from({length:101},(_,v)=>Math.hypot(...[0,1,2].map(k=>p[3*v+k]-probe.rest[3*v+k]))));
  const retainedMotion=displacement(smooth)/displacement(legacy);
  assert.ok(retainedMotion>.65 && retainedMotion<1.4,'remove fine creases, not the broad elastic bend');
  for(let j=0;j<5;j++) skinSmooth(skin,sim.rest,sim.x,world.render.rest,out,3);
  const timed=performance.now();
  for(let j=0;j<30;j++) skinSmooth(skin,sim.rest,sim.x,world.render.rest,out,3);
  console.log(type,{before,after,retainedMotion,affineError,fallbacks:skin.fallbacks,influences:skin.ids.length,
    skinSetupMs:Math.round(skinSetupMs),skinFrameMs:(performance.now()-timed)/30,totalCheckMs:Math.round(performance.now()-start)});
  assert.ok(after.peak < before.peak*.65 && after.rms < before.rms*.8,'fine displacement creases must decrease on a real tiny grab');
}

// Two adjacent cut faces are allowed to move independently. Rest-space
// proximity must never blend their influence lists across the new seam.
const bear=initialPiece(), parts=splitPiece(bear.I,1,0,0).map(I=>({...bear,I,cache:null}));
const cut=buildWorld(parts), sim=new SoftBody(cut.sim);
const skin=buildSmoothSkin(sim,cut.render,cut.skinIdx,cut.skinW);
for(let v=0;v<cut.render.rest.length/3;v++) for(let j=skin.starts[v];j<skin.starts[v+1];j++)
  assert.equal(sim.comp[skin.ids[j]],cut.render.vComp[v]);
const output=new Float64Array(cut.render.rest.length);
for(let i=0;i<sim.n;i++) sim.x[3*i] += sim.comp[i]===0 ? -.7 : .7;
skinSmooth(skin,sim.rest,sim.x,cut.render.rest,output,3);
for(let v=0;v<output.length/3;v++)
  assert.ok(Math.abs(output[3*v]-cut.render.rest[3*v]-(cut.render.vComp[v]===0?-.7:.7))<1e-6);
console.log('component-local affine skin and tiny-pull crease regressions passed');