import { parkLevel } from './park';
import { plazaLevel } from './plaza';
import { pierLevel } from './pier';
import { arenaLevel } from './arena';
import { megaLevel } from './mega';
export * from './common';

/** Story chapters, in order. */
export const LEVELS = [parkLevel, plazaLevel, pierLevel, arenaLevel];

/** Every rideable park: the story chapters first (same indices), then free-skate-only parks. */
export const PARKS = [...LEVELS, megaLevel];
