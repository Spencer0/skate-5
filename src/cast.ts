import type { CharId } from './levels';

export interface Character {
  name: string;
  role: string;
  color: string;
  ink: string;
}

export const CAST: Record<CharId, Character> = {
  mara: { name: 'Mara', role: 'Crew leader', color: '#788C5D', ink: '#FAF9F5' },
  dex: { name: 'Dex', role: 'Local legend (self-declared)', color: '#6A9BCC', ink: '#FAF9F5' },
  kai: { name: 'Kai Moreno', role: 'Spark Skateboards team manager', color: '#D97757', ink: '#FAF9F5' },
  pete: { name: 'Officer Pete', role: 'Plaza security', color: '#3D3B36', ink: '#F0EEE6' },
  announcer: { name: 'Announcer', role: 'The Claude Classic', color: '#B85C3E', ink: '#FAF9F5' },
  you: { name: 'You', role: 'The kid with the flick', color: '#F0EEE6', ink: '#141413' },
};

const cache = new Map<CharId, string>();

/** A simple drawn portrait: colored disc, initial, little beanie or cap. */
export function portrait(id: CharId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const c = CAST[id];
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  g.fillStyle = c.color;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  // head
  g.fillStyle = 'rgba(250,249,245,0.92)';
  g.beginPath();
  g.arc(S / 2, S * 0.56, S * 0.24, 0, Math.PI * 2);
  g.fill();
  // headwear varies by character
  g.fillStyle = '#141413';
  if (id === 'pete') {
    g.fillRect(S * 0.24, S * 0.28, S * 0.52, S * 0.12);
    g.fillRect(S * 0.3, S * 0.4, S * 0.52, S * 0.05);
  } else if (id === 'kai' || id === 'announcer') {
    g.beginPath();
    g.arc(S / 2, S * 0.48, S * 0.25, Math.PI, 0);
    g.fill();
    g.fillRect(S * 0.5, S * 0.45, S * 0.34, S * 0.05);
  } else if (id !== 'you') {
    g.beginPath();
    g.ellipse(S / 2, S * 0.42, S * 0.26, S * 0.18, 0, Math.PI, 0);
    g.fill();
  }
  // eyes
  g.fillStyle = '#141413';
  g.beginPath();
  g.arc(S * 0.42, S * 0.58, 4, 0, Math.PI * 2);
  g.arc(S * 0.58, S * 0.58, 4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#141413';
  g.lineWidth = 3;
  g.beginPath();
  if (id === 'dex') {
    g.moveTo(S * 0.42, S * 0.69);
    g.lineTo(S * 0.6, S * 0.66);
  } else {
    g.arc(S / 2, S * 0.64, S * 0.08, 0.2 * Math.PI, 0.8 * Math.PI);
  }
  g.stroke();
  const url = cv.toDataURL();
  cache.set(id, url);
  return url;
}
