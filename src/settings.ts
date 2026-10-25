import type { RiderStyle } from './rider';

export const CAMERAS = [
  { id: 'chase', name: 'Chase' },
  { id: 'classic', name: 'Classic' },
  { id: 'overhead', name: 'Overhead' },
  { id: 'filmer', name: 'Filmer' },
] as const;

/** How many park locals skate with you (src/npcs.ts). */
export type NpcSetting = 'off' | 'few' | 'normal';
export const NPC_SETTINGS: { id: NpcSetting; name: string }[] = [
  { id: 'off', name: 'Off' },
  { id: 'few', name: 'Few' },
  { id: 'normal', name: 'Normal' },
];

export interface Options {
  camera: number;
  rider: RiderStyle;
  autoRevert: boolean;
  /** shows the REC button so lines can be saved for the Studio */
  recording: boolean;
  /** park locals; unset until the player picks one (the default can then follow the graphics tier) */
  npcs?: NpcSetting;
}

/** The NPC setting in effect. */
export function npcSetting(o: Options): NpcSetting {
  return NPC_SETTINGS.some((x) => x.id === o.npcs) ? o.npcs! : 'normal';
}

const KEY = 'skate5.options';

export function loadOptions(): Options {
  const def: Options = { camera: 0, rider: 'solid', autoRevert: true, recording: false };
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
