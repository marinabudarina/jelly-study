// ─────────────────────────────────────────────────────────────
//  Editorial corner typography painted INTO the backdrop.
//  Returns a canvas whose alpha channel is ink coverage; the GPU
//  background pass and the CPU still preview both darken the floor
//  by it, so the candies always sit in front of the words.
//  Semantic copy lives in index.html (#studyTitle / #studyCopy).
// ─────────────────────────────────────────────────────────────

export const TYPE_TITLE = ['JELLY', 'STUDY'];
export const TYPE_COPY = 'A playful study of shape, stretch and motion. Pull a form, split it, and watch it settle back into itself.';
export const TYPE_LABEL = 'A STUDY IN SOFTNESS';

const DISPLAY = '"Geist", "Segoe UI", system-ui, sans-serif';
const TITLE_FONT = '"Outfit", "Geist", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';

// Mirrors styles.css: --gutter, --bar, add bar and dock footprints.
function layout(cssW, cssH) {
  const compact = cssW <= 700 || cssH <= 520;
  const gutter = Math.min(28, Math.max(14, cssW * 0.022));
  const bar = compact ? 46 : 52;
  let size, top;
  if (compact) {
    // add chips wrap across the top on phones: start below them
    size = Math.min(cssW * 0.17, cssH * 0.11, 76);
    top = bar + (cssW <= 420 ? 104 : 72);
  } else {
    // keep "STUDY" left of the centred add bar (~360px wide)
    size = Math.min(cssW * 0.1, cssH * 0.15, (cssW / 2 - 200 - gutter) / 3.0, 150);
    top = bar + gutter + 4;
  }
  size = Math.max(34, size);
  const notice = document.querySelector('.fallback:not([hidden]) .fallback-notice');
  if (compact && notice) top = Math.max(top, notice.getBoundingClientRect().bottom + 16);
  const copyW = Math.min(250, cssW - gutter * 2);
  // desktop dock (hint + toolbar) is ~470px wide; beside it if there is room
  const besideDock = !compact && (cssW - 480) / 2 > copyW + gutter + 16;
  const bottom = besideDock ? gutter + 6 : gutter + (compact ? 132 : 96);
  return { gutter, size, top, copyW, bottom, compact };
}

function wrap(ctx, text, maxW) {
  const words = text.split(' '), lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

let cache = null;
/** Draw at device resolution. `scale` = device px per CSS px. */
export function typeLayer(width, height, scale) {
  const noticeBottom = document.querySelector('.fallback:not([hidden]) .fallback-notice')?.getBoundingClientRect().bottom || 0;
  const key = `${width}x${height}@${scale.toFixed(3)}:${fontsReady() ? 1 : 0}:${noticeBottom}`;
  if (cache && cache.key === key) return cache.canvas;
  const c = cache?.canvas || document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const cssW = width / scale, cssH = height / scale;
  const L = layout(cssW, cssH);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';

  // title, top-left: rounded geometric display type, two lines
  ctx.textAlign = 'left';
  ctx.font = `700 ${L.size}px ${TITLE_FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(-0.035 * L.size).toFixed(2)}px`;
  const lh = L.size * 0.9;
  TYPE_TITLE.forEach((t, i) => ctx.fillText(t, L.gutter - L.size * 0.04, L.top + L.size * 0.74 + i * lh));

  // description, bottom-right
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
  const bodySize = L.compact ? 12 : 13;
  ctx.font = `400 ${bodySize}px ${DISPLAY}`;
  const lines = wrap(ctx, TYPE_COPY, L.copyW);
  const bodyLH = bodySize * 1.45;
  const x = cssW - L.gutter - L.copyW;
  let y = cssH - L.bottom - (lines.length - 1) * bodyLH;
  ctx.globalAlpha = 0.72;
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * bodyLH));
  ctx.globalAlpha = 0.5;
  ctx.font = `500 9.5px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '1.5px';
  ctx.fillText(TYPE_LABEL, x, y - bodyLH - 6);
  ctx.globalAlpha = 1;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  cache = { key, canvas: c };
  return c;
}

function fontsReady() { return !document.fonts || document.fonts.status === 'loaded'; }
/** Resolves when web fonts settle, so callers can repaint the layer. */
export function onTypeFonts(cb) {
  document.fonts?.ready?.then(async () => {
    // Canvas-only fonts need an explicit load; they have no visible DOM text.
    await Promise.allSettled([
      document.fonts.load('700 100px "Outfit"'),
      document.fonts.load('400 13px "Geist"'),
      document.fonts.load('500 9.5px "Geist Mono"'),
    ]);
    cache = null;
    cb();
  });
}
