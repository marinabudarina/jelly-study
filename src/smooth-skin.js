// Moving least-squares displacement skin. Single-tet barycentrics are C0:
// their gradient jumps on every internal tetrahedron face, showing as moving
// creases under a glossy light. Compact C2 particle kernels reconstruct a
// continuous local affine displacement instead. We never smooth rest positions
// (the molded face, rind and seeds remain exact), and never cross cut components.
function firstInverseColumn(matrix) {
  const a = matrix.map((row, i) => [...row, i === 0 ? 1 : 0]);
  for (let j = 0; j < 4; j++) {
    let pivot = j;
    for (let i = j + 1; i < 4; i++) if (Math.abs(a[i][j]) > Math.abs(a[pivot][j])) pivot = i;
    if (Math.abs(a[pivot][j]) < 1e-10) return null;
    [a[j], a[pivot]] = [a[pivot], a[j]];
    const scale = a[j][j];
    for (let k = j; k <= 4; k++) a[j][k] /= scale;
    for (let i = 0; i < 4; i++) if (i !== j) {
      const factor = a[i][j];
      for (let k = j; k <= 4; k++) a[i][k] -= factor * a[j][k];
    }
  }
  return a.map(row => row[4]);
}

export function buildSmoothSkin(sim, render, fallbackIdx, fallbackW, radius = 0.34) {
  const rest = sim.rest, cell = radius, grid = new Map();
  const key = (c, x, y, z) => `${c}:${x},${y},${z}`;
  for (let i = 0; i < rest.length / 3; i++) {
    const k = key(sim.comp[i], Math.floor(rest[3*i]/cell), Math.floor(rest[3*i+1]/cell), Math.floor(rest[3*i+2]/cell));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  const starts = [0], ids = [], weights = [];
  let fallbacks = 0;
  for (let v = 0; v < render.rest.length / 3; v++) {
    const p = render.rest.subarray(3*v, 3*v+3), c = render.vComp[v];
    let fit = null;
    for (let attempt = 0; attempt < 3 && !fit; attempt++) {
      const h = radius * (1 + attempt * 0.5), reach = Math.ceil(h/cell);
      const cx = Math.floor(p[0]/cell), cy = Math.floor(p[1]/cell), cz = Math.floor(p[2]/cell);
      const nodes = [], matrix = Array.from({length:4}, () => [0,0,0,0]);
      for (let x = cx-reach; x <= cx+reach; x++) for (let y = cy-reach; y <= cy+reach; y++) for (let z = cz-reach; z <= cz+reach; z++) {
        for (const i of grid.get(key(c,x,y,z)) || []) {
          const q = [1,(rest[3*i]-p[0])/h,(rest[3*i+1]-p[1])/h,(rest[3*i+2]-p[2])/h];
          const r = Math.hypot(q[1],q[2],q[3]);
          if (r >= 1) continue;
          const w = (1-r)**4 * (1+4*r);
          nodes.push({i,q,w});
          for (let a=0;a<4;a++) for (let b=0;b<4;b++) matrix[a][b] += w*q[a]*q[b];
        }
      }
      const inverse = firstInverseColumn(matrix);
      if (!inverse) continue;
      const ws = nodes.map(n => n.w * n.q.reduce((s,q,j)=>s+q*inverse[j],0));
      // Avoid ill-conditioned extrapolation at tiny isolated fragments.
      if (ws.reduce((s,w)=>s+Math.abs(w),0) < 4) fit = {nodes,ws};
    }
    if (fit) {
      fit.nodes.forEach((n,j) => { ids.push(n.i); weights.push(fit.ws[j]); });
    } else {
      fallbacks++;
      for (let j=0;j<4;j++) { ids.push(fallbackIdx[4*v+j]); weights.push(fallbackW[4*v+j]); }
    }
    starts.push(ids.length);
  }
  return { starts: new Uint32Array(starts), ids: new Uint32Array(ids), weights: new Float64Array(weights), fallbacks };
}

export function skinSmooth(skin, simRest, positions, renderRest, output, stride = 6) {
  const {starts, ids, weights} = skin;
  for (let v=0;v<starts.length-1;v++) {
    let dx=0,dy=0,dz=0;
    for (let j=starts[v];j<starts[v+1];j++) {
      const i=3*ids[j], w=weights[j];
      dx += (positions[i]-simRest[i])*w;
      dy += (positions[i+1]-simRest[i+1])*w;
      dz += (positions[i+2]-simRest[i+2])*w;
    }
    output[stride*v] = renderRest[3*v]+dx;
    output[stride*v+1] = renderRest[3*v+1]+dy;
    output[stride*v+2] = renderRest[3*v+2]+dz;
    if (stride === 6) output.fill(0, stride*v+3, stride*v+6);
  }
}