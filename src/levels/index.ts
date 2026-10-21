import { parkLevel } from './park';
import { plazaLevel } from './plaza';
import { pierLevel } from './pier';
export * from './common';

/** Story chapters, in order. */
export const LEVELS = [parkLevel, plazaLevel, pierLevel];
