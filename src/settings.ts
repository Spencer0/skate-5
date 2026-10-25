import type { RiderStyle } from './rider';
import type { QualitySetting } from './quality';

export const CAMERAS = [
  { id: 'chase', name: 'Chase' },
  { id: 'classic', name: 'Classic' },
  { id: 'overhead', name: 'Overhead' },
  { id: 'filmer', name: 'Filmer' },
] as const;

export interface Options {
  camera: number;
  rider: RiderStyle;
  autoRevert: boolean;
  /** shows the REC button so lines can be saved for the Studio */
  recording: boolean;
  /** graphics tier; 'auto' detects and adapts to the frame rate */
  quality: QualitySetting;
}

const KEY = 'skate5.options';

export function loadOptions(): Options {
  const def: Options = { camera: 0, rider: 'solid', autoRevert: true, recording: false, quality: 'auto' };
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
