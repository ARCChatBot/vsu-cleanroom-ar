// =====================================================================================
//  colormap.js
//  MI-CHIPS (NSF #2606117): colormaps. AR headsets with additive displays (HoloLens 2)
//  render black as transparent. The MI-CHIPS brand maps start at Trojan Blue (dim but visible
//  in a headset); the "Holo" maps keep a higher minimum brightness for bright rooms. Viridis and Inferno are kept for desktop use and screenshots.
// =====================================================================================

function make(name, hexes) {
  const stops = hexes.map((h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
  const rgb = (t) => {
    t = Math.min(Math.max(t, 0), 1);
    const f = t * (stops.length - 1), i = Math.min(Math.floor(f), stops.length - 2), k = f - i;
    const a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  };
  const css = (t) => {
    const [r, g, b] = rgb(t);
    return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
  };
  return { name, rgb, css };
}

export const COLORMAPS = [
  // MI-CHIPS brand maps (C03 Trojan Blue → C10 Ice Blue → C12 Caption Frost [→ C04 Orange]).
  make('MI-CHIPS Ice', ['#00358E', '#1F5FC0', '#3F8FE6', '#73C5FB', '#ACDBFC', '#E3EDFC']),
  make('MI-CHIPS Diverging', ['#00358E', '#3F8FE6', '#73C5FB', '#E3EDFC', '#FFC299', '#FF9447', '#FF6700']),
  make('Holo', ['#3E63DD', '#2FA4E7', '#2EC4B6', '#7BD14B', '#F2D43D', '#FF8A3D', '#FF4D6D']),
  make('Holo Diverging', ['#3B6FF5', '#8FB3FF', '#E6E6E6', '#FF9B7A', '#E8443A']),
  make('Viridis', ['#440154', '#472D7B', '#3B528B', '#2C728E', '#21918C', '#28AE80', '#5EC962', '#ADDC30', '#FDE725']),
  make('Inferno', ['#000004', '#1B0C41', '#4A0C6B', '#781C6D', '#A52C60', '#CF4446', '#ED6925', '#FB9B06', '#F7D13D', '#FCFFA4']),
];

export const defaultColormapIndex = (field) => (field.diverging ? 1 : 0); // brand maps by default
