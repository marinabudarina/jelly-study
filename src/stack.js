// Rest-space dye coordinates never move. These are display/physical sizes,
// not new material coordinates; the pear remains the reference size.
export const ITEM_SCALE = { cucumber: 0.58, orange: 0.82, pear: 1, bear: 1, watermelon: 1 };
export const itemScale = p => ITEM_SCALE[p.type] || 1;

export function makeStack(sim) {
  const layers = [];
  let bottom = 0.04;
  for (let c = 0; c < sim.nComp; c++) {
    const nodes = [];
    let xmin=Infinity,xmax=-Infinity,zmin=Infinity,zmax=-Infinity,ymin=Infinity,ymax=-Infinity;
    for(let i=0;i<sim.n;i++) if(sim.comp[i]===c) {
      nodes.push(i);
      xmin=Math.min(xmin,sim.rest[3*i]); xmax=Math.max(xmax,sim.rest[3*i]);
      ymin=Math.min(ymin,sim.rest[3*i+1]); ymax=Math.max(ymax,sim.rest[3*i+1]);
      zmin=Math.min(zmin,sim.rest[3*i+2]); zmax=Math.max(zmax,sim.rest[3*i+2]);
    }
    // An actual interior particle column (rather than an outline bounding box)
    // ensures the toothpick pierces even an off-centre cut fragment.
    const cx=(xmin+xmax)/2,cz=(zmin+zmax)/2;
    nodes.sort((a,b)=> Math.hypot(sim.rest[3*a]-cx,sim.rest[3*a+2]-cz)-Math.hypot(sim.rest[3*b]-cx,sim.rest[3*b+2]-cz));
    const x=sim.rest[3*nodes[0]],z=sim.rest[3*nodes[0]+2];
    const shift=[-x,bottom-ymin,-z], top=bottom+ymax-ymin;
    const anchors=nodes.filter(i=>Math.hypot(sim.rest[3*i]-x,sim.rest[3*i+2]-z)<0.22);
    layers.push({shift,bottom,top,anchors});
    bottom=top+0.14;
  }
  return {layers,height:bottom+0.48};
}

export function poseStack(sim, stack) {
  sim.endGrab();
  for(let i=0;i<sim.n;i++) {
    const shift=stack.layers[sim.comp[i]].shift;
    for(let k=0;k<3;k++) sim.x[3*i+k]=sim.rest[3*i+k]+shift[k];
  }
  sim.prev.set(sim.x); sim.v.fill(0); sim.skewer=stack;
}

export function stackPositions(render, stack) {
  const out=render.rest.slice();
  for(let i=0;i<out.length/3;i++) {
    const shift=stack.layers[render.vComp[i]].shift;
    for(let k=0;k<3;k++) out[3*i+k]+=shift[k];
  }
  return out;
}

export function buildSkewer(height) {
  const rest=[],nrm=[],index=[],mat=[], sides=16;
  for(const [y,r] of [[0,.026],[height-.23,.026],[height,.001]]) {
    for(let j=0;j<sides;j++) {
      const a=j*2*Math.PI/sides;
      rest.push(Math.cos(a)*r,y,Math.sin(a)*r);
      nrm.push(Math.cos(a),y>height-.24?.12:0,Math.sin(a)); mat.push(60);
    }
  }
  for(let row=0;row<2;row++) for(let j=0;j<sides;j++) {
    const a=row*sides+j,b=row*sides+(j+1)%sides,c=a+sides,d=b+sides;
    index.push(a,c,b,b,c,d);
  }
  return {rest:new Float32Array(rest),nrm:new Float32Array(nrm),mat:new Float32Array(mat),index:new Uint32Array(index)};
}

export function stackPreview(render, stack, rod) {
  if(!stack) return render;
  const n=render.rest.length/3, positions=stackPositions(render,stack);
  const rest=new Float32Array(positions.length+rod.rest.length); rest.set(positions);rest.set(rod.rest,positions.length);
  const materialRest=new Float32Array(rest.length); materialRest.set(render.materialRest||render.rest);materialRest.set(rod.rest,positions.length);
  const mat=new Float32Array(n+rod.mat.length);mat.set(render.mat);mat.set(rod.mat,n);
  const vComp=new Uint16Array(mat.length);vComp.set(render.vComp);vComp.fill(65535,n);
  const index=new Uint32Array(render.index.length+rod.index.length);index.set(render.index);
  index.set(rod.index.map(v=>v+n),render.index.length);
  return {...render,rest,materialRest,mat,vComp,index,props:{first:render.index.length,count:rod.index.length}};
}

export function skewerRayDistance(ray,rod) {
  if(!rod) return Infinity;
  const {o,d}=ray,p=rod.rest;
  let best=Infinity;
  for(let t=0;t<rod.index.length;t+=3) {
    const a=rod.index[t]*3,b=rod.index[t+1]*3,c=rod.index[t+2]*3;
    const e=[p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2]];
    const f=[p[c]-p[a],p[c+1]-p[a+1],p[c+2]-p[a+2]];
    const h=[d[1]*f[2]-d[2]*f[1],d[2]*f[0]-d[0]*f[2],d[0]*f[1]-d[1]*f[0]];
    const det=e[0]*h[0]+e[1]*h[1]+e[2]*h[2];
    if(Math.abs(det)<1e-10) continue;
    const s=[o[0]-p[a],o[1]-p[a+1],o[2]-p[a+2]];
    const u=(s[0]*h[0]+s[1]*h[1]+s[2]*h[2])/det;
    if(u<0||u>1) continue;
    const q=[s[1]*e[2]-s[2]*e[1],s[2]*e[0]-s[0]*e[2],s[0]*e[1]-s[1]*e[0]];
    const v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])/det;
    if(v<0||u+v>1) continue;
    const distance=(f[0]*q[0]+f[1]*q[1]+f[2]*q[2])/det;
    if(distance>0) best=Math.min(best,distance);
  }
  return best;
}