import type { RiderStyle } from './rider';

export const CAMERAS = [
  { id: 'chase', name: 'Chase' },
  { id: 'classic', name: 'Classic' },
  { id: 'overhead', name: 'Overhead' },
  { id: 'filmer', name: 'Filmer' },
] as const;

export interface Options {
  camera: number;
  rider: RiderStyle;
}

const KEY = 'skate5.options';

export function loadOptions(): Options {
  const def: Options = { camera: 0, rider: 'ghost' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<Options>) };
  } catch {
    /* ignore */
  }
  return def;
}

export function saveOptions(o: Options) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}
