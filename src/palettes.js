// Colour varieties (linear RGB), backdrop colour and the illustrative physical scale.

export const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const hex = rgb => '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');

// Gummy-candy varieties (linear RGB), from monochrome lab studies to fruit tones.
export const PALETTES = {
  obsidian: {
    name: 'Black',
    flesh: [0.008, 0.008, 0.008], fleshDeep: [0.003, 0.003, 0.003],
    pale: [0.035, 0.035, 0.035], skin: [0.012, 0.012, 0.012], stripe: [0.02, 0.02, 0.02],
    seed: [0.012, 0.012, 0.012], shadowTint: [0.22, 0.22, 0.22],
    ui: { flesh: [0.006, 0.006, 0.006] },
  },
  pearl: {
    name: 'White',
    flesh: [0.94, 0.94, 0.94], fleshDeep: [0.68, 0.68, 0.68],
    pale: [0.98, 0.98, 0.98], skin: [0.72, 0.72, 0.72], stripe: [0.84, 0.84, 0.84],
    seed: [0.008, 0.008, 0.008], shadowTint: [0.68, 0.68, 0.68],
    ui: { flesh: [0.82, 0.82, 0.82] },
  },
  berry: {
    name: 'Berry',
    flesh: [0.82, 0.055, 0.19], fleshDeep: [0.31, 0.012, 0.055],
    pale: [0.92, 0.35, 0.48], skin: [0.2, 0.018, 0.06], stripe: [0.32, 0.025, 0.085],
    seed: [0.31, 0.012, 0.055], shadowTint: [0.56, 0.34, 0.4],
    ui: { flesh: [0.68, 0.025, 0.12] },
  },
  citrus: {
    name: 'Citrus',
    flesh: [0.98, 0.56, 0.045], fleshDeep: [0.54, 0.2, 0.012],
    pale: [1.0, 0.8, 0.24], skin: [0.26, 0.09, 0.008], stripe: [0.38, 0.16, 0.012],
    seed: [0.54, 0.2, 0.012], shadowTint: [0.66, 0.51, 0.32],
    ui: { flesh: [0.82, 0.34, 0.015] },
  },
  amber: {
    name: 'Amber',
    flesh: [0.94, 0.24, 0.009], fleshDeep: [0.43, 0.085, 0.003],
    pale: [1.0, 0.62, 0.09], skin: [0.38, 0.095, 0.003], stripe: [0.52, 0.16, 0.006],
    seed: [0.48, 0.12, 0.005], shadowTint: [0.68, 0.43, 0.26],
    ui: { flesh: [0.8, 0.25, 0.009] },
  },
  lavender: {
    name: 'Lavender',
    flesh: [0.48, 0.25, 0.88], fleshDeep: [0.16, 0.075, 0.36],
    pale: [0.75, 0.59, 0.98], skin: [0.12, 0.055, 0.28], stripe: [0.2, 0.1, 0.42],
    seed: [0.16, 0.075, 0.36], shadowTint: [0.48, 0.39, 0.62],
    ui: { flesh: [0.35, 0.15, 0.68] },
  },
};

export const BG_SRGB = [233 / 255, 231 / 255, 225 / 255]; // Seamless page / studio sweep.
export const BG_LIN = BG_SRGB.map(srgbToLin);
// tone mapper subtracts a small toe offset; lift the backdrop so it lands on the page colour
export const BG_RENDER = BG_LIN.map(c => c + 0.04);

export const SCALE_CM = 3.5;      // illustrative: 1 simulation unit ≈ 3.5 cm
export const DENSITY = 1.3;       // g/cm³, gummy candy
