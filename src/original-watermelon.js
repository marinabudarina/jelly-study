// Restored from b9335be's sector, rounded extrusion and deterministic inclusions.
// Coordinates are recentered/reversed in z for the current collection camera.
import { delaunay, rng } from './geometry.js';

export const MELON = { alpha: 32*Math.PI/180, Ri: 1.62, rho: 0.17, T: 0.58, bevel: 0.13, Ro: 1.79, skin: 0.075, pale: 0.25, center: 0.81 };

export function melonOutline() {
  const inner=[[0,0]];
  for(let k=0;k<=40;k++) {
    const a=Math.PI/2-MELON.alpha+2*MELON.alpha*k/40;
    inner.push([Math.cos(a)*MELON.Ri,Math.sin(a)*MELON.Ri]);
  }
  const out=[];
  for(let i=0;i<inner.length;i++) {
    const prev=inner[(i+inner.length-1)%inner.length],p=inner[i],next=inner[(i+1)%inner.length];
    const a0=Math.atan2(-(p[0]-prev[0]),p[1]-prev[1]);
    const a1=Math.atan2(-(next[0]-p[0]),next[1]-p[1]);
    const da=(a1-a0+Math.PI*2)%(Math.PI*2), n=Math.max(1,Math.ceil(da/0.1));
    for(let k=0;k<=n;k++) {
      const a=a0+da*k/n;
      out.push([p[0]+MELON.rho*Math.cos(a),MELON.center-p[1]-MELON.rho*Math.sin(a)]);
    }
  }
  return out.reverse();
}

// The current piece polygon is the *outer* boundary, including fresh cuts.
// Insetting that boundary for the cap keeps the original .13 roundover while
// never expanding cuts into their neighbours (the old inner-polygon convention).
export function buildMelonRender(I, inside, distance, lattice) {
  let b=MELON.bevel, core;
  const pos=[], mat=[], body=[], seeds=[], bubbles=[];
  // Intersect inset halfplanes; unlike bisector-only offsets this also handles
  // cut tips whose adjacent short edges disappear during the inset.
  for(let attempt=0;attempt<12;attempt++) {
    core=I.map(p=>p.slice());
    for(let i=0;i<I.length && core.length;i++) {
      const p=I[i],q=I[(i+1)%I.length],l=Math.hypot(q[0]-p[0],q[1]-p[1]);
      const nx=(q[1]-p[1])/l,nz=-(q[0]-p[0])/l,c=nx*p[0]+nz*p[1]-b-.01,out=[];
      for(let j=0;j<core.length;j++) {
        const a=core[j],v=core[(j+1)%core.length],da=nx*a[0]+nz*a[1]-c,dv=nx*v[0]+nz*v[1]-c;
        if(da<=0) out.push(a);
        if((da<0)!==(dv<0)) {const t=da/(da-dv);out.push([a[0]+(v[0]-a[0])*t,a[1]+(v[1]-a[1])*t]);}
      }
      core=out.filter((p,j)=>Math.hypot(p[0]-out[(j+out.length-1)%out.length][0],p[1]-out[(j+out.length-1)%out.length][1])>1e-6);
    }
    if(core.length>=3) break;
    b*=.5;
  }
  if(core.length<3) throw new Error('Watermelon fragment is too thin to round');
  const samples=[];
  const add=(q,a)=>samples.push({inner:[q[0]+.01*Math.cos(a),q[1]+.01*Math.sin(a)],outer:[q[0]+(b+.01)*Math.cos(a),q[1]+(b+.01)*Math.sin(a)]});
  for(let i=0;i<core.length;i++) {
    const p=core[i],prev=core[(i+core.length-1)%core.length],next=core[(i+1)%core.length];
    const a0=Math.atan2(-(p[0]-prev[0]),p[1]-prev[1]),a1=Math.atan2(-(next[0]-p[0]),next[1]-p[1]);
    const da=(a1-a0+Math.PI*2)%(Math.PI*2),na=Math.max(1,Math.ceil(da/.1));
    for(let k=0;k<na;k++) add(p,a0+da*k/na);
    const n=Math.max(1,Math.ceil(Math.hypot(next[0]-p[0],next[1]-p[1])/.03));
    for(let k=0;k<n;k++) {
      const t=k/n;add([p[0]+(next[0]-p[0])*t,p[1]+(next[1]-p[1])*t],a1);
    }
  }
  const cap=samples.map(s=>s.inner);
  const N=samples.length,rings=[];
  for(let j=0;j<=8;j++) {const a=-Math.PI/2+Math.PI*j/16;rings.push([Math.cos(a),b+b*Math.sin(a)]);}
  for(let j=1;j<3;j++) rings.push([1,b+(MELON.T-2*b)*j/3]);
  for(let j=0;j<=8;j++) {const a=Math.PI*j/16;rings.push([Math.cos(a),MELON.T-b+b*Math.sin(a)]);}
  for(const [d,y] of rings) for(const s of samples) {
    pos.push(s.inner[0]+(s.outer[0]-s.inner[0])*d,y,s.inner[1]+(s.outer[1]-s.inner[1])*d);mat.push(10);
  }
  for(let j=0;j<rings.length-1;j++) for(let k=0;k<N;k++) {
    const a=j*N+k,c=a+N,bb=j*N+(k+1)%N,d=bb+N;body.push(a,c,bb,bb,c,d);
  }
  const cp=samples.flatMap(s=>s.inner);
  const more=lattice(cap,0,0.048,(x,z)=>distance(cap,x,z)<-0.03);
  cp.push(...more);
  const top=[],bottom=[];
  for(let k=0;k<cp.length/2;k++) {
    if(k<N) {bottom.push(k);top.push((rings.length-1)*N+k);}
    else {
      bottom.push(mat.length);pos.push(cp[2*k],0,cp[2*k+1]);mat.push(10);
      top.push(mat.length);pos.push(cp[2*k],MELON.T,cp[2*k+1]);mat.push(10);
    }
  }
  const tris=delaunay(cp);
  for(let k=0;k<tris.length;k+=3) {
    const [a,c,d]=tris.slice(k,k+3);
    // Delaunay returns CCW in x/z: top must point toward +y.
    const cross=(cp[2*c]-cp[2*a])*(cp[2*d+1]-cp[2*a+1])-(cp[2*c+1]-cp[2*a+1])*(cp[2*d]-cp[2*a]);
    const bb=cross>0?d:c,cc=cross>0?c:d;
    body.push(top[a],top[bb],top[cc],bottom[a],bottom[cc],bottom[bb]);
  }
  for(const prop of melonProps()) {
    if(distance(I,prop.x,prop.z)+prop.rad>-0.02) continue;
    const base=mat.length;
    pos.push(...prop.pos);mat.push(...Array(prop.pos.length/3).fill(prop.mat));
    (prop.mat===11?seeds:bubbles).push(...prop.idx.map(v=>v+base));
  }
  return {rest:new Float32Array(pos),mat:new Float32Array(mat),body,seeds,bubbles};
}

let props;
function melonProps() {
  if(props) return props;
  props=[];const R=rng(9),seeds=[];
  for(const face of [1,-1]) for(const row of [{r:.46,n:2},{r:.68,n:3},{r:.9,n:4},{r:1.12,n:5},{r:1.33,n:5}]) {
    const maxTh=MELON.alpha-.19/row.r-.02;
    for(let i=0;i<row.n;i++) seeds.push({r:row.r+(R()-.5)*.08,th:(i/(row.n-1)*2-1)*maxTh*.88+(R()-.5)*.06+(face<0?.05:0),face,s:.85+R()*.3});
  }
  seeds.push({r:.9,th:.12,face:0,s:.9},{r:1.12,th:-.2,face:0,s:.8});
  const add=(x,z,rad,material,rows,cols,vertex)=>{
    const pos=[],idx=[];
    for(let i=0;i<=rows;i++) for(let j=0;j<cols;j++) pos.push(...vertex(Math.PI*i/rows,2*Math.PI*j/cols));
    for(let i=0;i<rows;i++) for(let j=0;j<cols;j++) {
      const a=i*cols+j,bb=i*cols+(j+1)%cols,c=a+cols,d=bb+cols;idx.push(a,c,bb,bb,c,d);
    }
    props.push({x,z,rad,mat:material,pos,idx});
  };
  for(const sd of seeds) {
    const L=.15*sd.s,W=.088*sd.s,H=.042*sd.s,cx=Math.sin(sd.th)*sd.r,cz=Math.cos(sd.th)*sd.r;
    const tilt=(R()-.5)*.25,cy=sd.face>0?MELON.T-H*.64:sd.face<0?H*.64:MELON.T*(.35+R()*.25);
    add(cx,MELON.center-cz,L*.5,11,10,12,(t,ph)=>{
      const s=(1-Math.cos(t))/2,prof=Math.sin(t)**.9*(.38+.62*s**.7);
      const la=Math.cos(ph)*prof*W/2,al=(s-.5)*L,up=Math.sin(ph)*prof*H/2+al*tilt*.3;
      return [cx+Math.sin(sd.th)*al+Math.cos(sd.th)*la,cy+up,MELON.center-cz-Math.cos(sd.th)*al+Math.sin(sd.th)*la];
    });
  }
  const bubbles=[];
  for(let i=0;i<9;i++) {
    const r=.45+R()*.85,th=(R()*2-1)*(MELON.alpha-.14/r)*.9;
    const rad=.009+R()*R()*.02,y=R()<.6?MELON.T-.035-R()*.16:.05+R()*.14;
    bubbles.push([Math.sin(th)*r,y,Math.cos(th)*r,rad]);
  }
  bubbles.push([.22,MELON.T-.06,.45,.012],[-.2,MELON.T-.09,1.05,.016]);
  for(const [x,y,z,r] of bubbles) add(x,MELON.center-z,r,2,8,12,(t,p)=>[x+Math.sin(t)*Math.cos(p)*r,y+Math.cos(t)*r,MELON.center-z-Math.sin(t)*Math.sin(p)*r]);
  return props;
}