/**
 * P2.12 — forward-compatible story / normal mode boundary contract.
 *
 * Intentionally NOT connected to the current preview or any storage writer.
 * Normal play retains its existing save key and engine. Story progression is
 * a separate, bounded, content-pack-oriented record; never transfers coins,
 * XP, energy, inventory or achievements between modes.
 */
import { SAVE_KEY } from './storage.mjs';

export const GAME_MODES = Object.freeze({ NORMAL:'normal', STORY:'story' });
export const STORY_PROGRESS_VERSION = 1;
export const STORY_SAVE_KEY = 'toolbox.merge-isle.story.local.v1';
export const MAX_STORY_PACKS = 24;
export const MAX_STORY_SAVE_BYTES = 128_000;
export const MAX_TRACKED_NODES = 512;
const MAX_TRACKED_FLAGS = 256;
export const MAX_TRACKED_CHOICES = 256;
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const packPattern = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31})?$/;
const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keysAre = (value,keys) => record(value) &&
  Object.keys(value).length === keys.length && keys.every(key=>own(value,key));
const reservedNames = new Set(['__proto__','constructor','prototype']);
const validId = value => typeof value === 'string' &&
  idPattern.test(value) && !reservedNames.has(value);
const validPackId = value => typeof value === 'string' &&
  packPattern.test(value) && value.split('.').every(part=>!reservedNames.has(part));
const boundedUniqueIds = value => Array.isArray(value) &&
  value.length <= MAX_TRACKED_NODES &&
  value.every(validId) && new Set(value).size === value.length;
const boundedDictionary = (value,max,validValue) => record(value) &&
  Object.keys(value).length <= max &&
  Object.entries(value).every(([key,entry])=>validId(key) && validValue(entry));

export function getModeSaveKey(mode) {
  if(mode === GAME_MODES.NORMAL) return SAVE_KEY;
  if(mode === GAME_MODES.STORY) return STORY_SAVE_KEY;
  throw new RangeError('Unknown game mode');
}

/** No fixed mainline ending, chapter count or DLC list is baked into state. */
export function createEmptyStoryProgress() {
  return {schemaVersion:STORY_PROGRESS_VERSION,mode:GAME_MODES.STORY,
    revision:0,activePackId:null,packs:{}};
}

/** Each pack can independently expand mainline, side quests, incidents and choices. */
export function createEmptyStoryPack() {
  return {checkpoint:null,completed:{main:[],side:[],incident:[]},
    choices:{},flags:{}};
}

export function validateStoryProgress(save) {
  if(!keysAre(save,['schemaVersion','mode','revision','activePackId','packs']) ||
    save.schemaVersion !== STORY_PROGRESS_VERSION ||
    save.mode !== GAME_MODES.STORY ||
    !Number.isSafeInteger(save.revision) || save.revision < 0 ||
    !record(save.packs)) return false;
  const names=Object.keys(save.packs);
  if(names.length>MAX_STORY_PACKS || !names.every(validPackId) ||
    (save.activePackId!==null &&
      (!validPackId(save.activePackId) || !own(save.packs,save.activePackId))))
    return false;
  for(const name of names) {
    const pack=save.packs[name];
    if(!keysAre(pack,['checkpoint','completed','choices','flags']) ||
      (pack.checkpoint!==null && !validId(pack.checkpoint)) ||
      !keysAre(pack.completed,['main','side','incident']) ||
      !['main','side','incident'].every(kind=>boundedUniqueIds(pack.completed[kind])) ||
      !boundedDictionary(pack.choices,MAX_TRACKED_CHOICES,validId) ||
      !boundedDictionary(pack.flags,MAX_TRACKED_FLAGS,value=>typeof value==='boolean'))
      return false;
  }
  try {return JSON.stringify(save).length<=MAX_STORY_SAVE_BYTES;}
  catch {return false;}
}

/** Pure, idempotent pack registration. Nothing is persisted or granted. */
export function registerStoryPack(save,packId) {
  if(!validateStoryProgress(save) || !validPackId(packId))
    throw new TypeError('Invalid story pack request');
  if(own(save.packs,packId))return save;
  if(Object.keys(save.packs).length>=MAX_STORY_PACKS ||
    save.revision===Number.MAX_SAFE_INTEGER)
    throw new RangeError('Story pack budget exceeded');
  const next={...save,revision:save.revision+1,
    activePackId:save.activePackId??packId,
    packs:{...save.packs,[packId]:createEmptyStoryPack()}};
  if(!validateStoryProgress(next))throw new RangeError('Story pack exceeds storage budget');
  return next;
}
