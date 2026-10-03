import { PALETTES } from './palettes.js';

const colors = Object.values(PALETTES).map(p => p.flesh);
const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
const mix = (a,b,t) => a.map((v,i)=>v+(b[i]-v)*t);
const fract = x => x-Math.floor(x);
function noise(x,y,z) {
  const hash=(x,y,z)=>{
    let a=fract(x*.1031),b=fract(y*.1031),c=fract(z*.1031);
    const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);
    a+=d;b+=d;c+=d;return fract((a+b)*c);
  };
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  const u=smooth(0,1,fract(x)),v=smooth(0,1,fract(y)),w=smooth(0,1,fract(z));
  let n=0;
  for(let a=0;a<2;a++) for(let b=0;b<2;b++) for(let c=0;c<2;c++)
    n+=hash(ix+a,iy+b,iz+c)*(a?u:1-u)*(b?v:1-v)*(c?w:1-w);
  return n;
}
const fbm=(x,y,z)=>.55*noise(x,y,z)+.3*noise(x*2.13+7.1,y*2.13+7.1,z*2.13+7.1)+.15*noise(x*4.37+3.3,y*4.37+3.3,z*4.37+3.3);
function tissue(x,z) {
  // Banded fruit fibers are low contrast and smoothly filtered, not surface grit.
  return 0.5 + 0.25*Math.sin(x*71+Math.sin(z*13)*2) + 0.25*Math.sin(z*49+x*17);
}
// Every candy occupies a 3.4-unit rest-space slot; rest coordinates retain the
// original dye layout when stretched or cut.
export function candyColor(material, x, z, fallback, y=0.58) {
  const tintIndex=Math.floor(material/1000)-1,natural=material%1000;
  const color=naturalColor(natural,x,z,fallback,y);
  if(tintIndex<0 || ![10,20,30,40].includes(natural)) return color;
  const tint=colors[tintIndex];
  if(!tint) throw new Error('Unknown encoded fruit tint');
  const luminance=color[0]*.2126+color[1]*.7152+color[2]*.0722;
  return mix(color,tint.map(c=>Math.min(.98,c*(.3+Math.sqrt(luminance)*1.15))),.86);
}
function naturalColor(material, x, z, fallback, y) {
  if (material >= 100) return colors[Math.round(material) - 100] || fallback;
  if (material === 11) return [0.01,0.0065,0.005];
  if (material === 2) return [0.9,0.84,0.82];
  if (material === 31) return [0.8,0.85,0.46];
  if (material === 21) return [.88,.8,.46];
  if (material === 22) return [.98,.43,.028];
  if (material === 41) return [.045,.012,.006];
  if (material === 42) return [.73,.61,.3];
  x -= Math.round(x / 3.4) * 3.4;
  z -= Math.round(z / 3.4) * 3.4;
  const r = Math.hypot(x, z - 0.68);
  if (material >= 9 && material < 15) {
    const radius=Math.hypot(x,.81-z),th=Math.atan2(x,.81-z);
    const wob=fbm(th*9,y*3,1.7)-.5,depth=1.79-radius+wob*.018;
    const skin=1-smooth(.067,.085,depth),pale=(1-smooth(.215+wob*.035,.285+wob*.035,depth))*(1-skin);
    const stripe=smooth(-.05,.35,Math.sin(th*34+fbm(th*5,y*2.2,3)*7+fbm(th*22,y*7,9)*2.5))*(1-smooth(.02,.1,depth));
    let skinCol=mix([.03,.13,.035],[.005,.034,.01],stripe);
    skinCol=mix(skinCol,mix([.03,.13,.035],[.8,.86,.62],.35),smooth(.02,.07,depth)*.6);
    return [.93,.07,.11].map((c,k)=>c*(1-skin-pale)+[.8,.86,.62][k]*pale+skinCol[k]*skin);
  }
  if (material >= 19 && material < 25) {
    const radius = Math.hypot(x,z), angle = Math.atan2(x,z);
    const pores=noise(x*89,y*71,z*89),pulp=fbm(radius*31,angle*12,y*15);
    if (radius > 1.09) return mix([.77,.145,.003],[1,.34,.008],pores*.75);
    const membrane = Math.max(1-smooth(0.01,0.022,Math.abs(Math.sin(angle*5))*radius),
      smooth(1.025,1.045,radius), 1-smooth(0.055,0.095,radius));
    return mix(mix([.91,.22,.008],[1,.43,.028],pulp),[.98,.86,.52],membrane*.9);
  }
  if (material >= 29 && material < 35) {
    const radius = Math.hypot(x,z), angle = Math.atan2(x,z);
    const skin = smooth(1.035,1.09,radius);
    let lobes = 0;
    for (let k=0;k<3;k++) {
      const a=k*Math.PI*2/3, along=x*Math.sin(a)+z*Math.cos(a), across=x*Math.cos(a)-z*Math.sin(a);
      lobes += Math.exp(-(((along-0.36)/0.31)**2)-(across/0.18)**2);
    }
    const chamber = 1-Math.exp(-lobes*1.2);
    const flesh = mix([.65,.82,.4],[.83,.93,.62],fbm(x*23,y*9,z*23)*.65);
    const skinCol=mix([.009,.085,.012],[.028,.23,.024],noise(angle*23,y*4,2)*.65+noise(x*91,y*67,z*91)*.25);
    return mix(mix(flesh,[.42,.68,.26],chamber*.5),skinCol,skin);
  }
  if(material===40) {
    const boundX=.66-.27*Math.max(-1,Math.min(1,z/1.16));
    const radius=Math.hypot(x/boundX,z/1.16);
    const edge=smooth(.89,.98,radius);
    const core=Math.exp(-((x/.22)**2+((z+.27)/.38)**2));
    const thread=Math.exp(-((x/.018)**2))*smooth(-.1,.75,z)*(1-smooth(.8,1.12,z));
    const grain=fbm(x*43,y*13,z*37),pores=smooth(.64,.78,noise(x*117,y*91,z*117));
    const blush=Math.exp(-(((x+.47)/.28)**2+((z+.35)/.55)**2));
    const skin=mix(mix([.39,.49,.052],[.62,.22,.058],blush*.7),[.18,.19,.026],pores*.55);
    const flesh=mix([.91,.88,.64],[.99,.96,.78],grain*.6);
    return mix(mix(flesh,[.64,.54,.28],core*.3+thread*.19),skin,edge);
  }
  return fallback;
}