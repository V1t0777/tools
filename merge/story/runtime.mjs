/** Side-effect-free narrative runtime; NEVER writes to normal-mode economy. */
import {registerStoryPack,validateStoryProgress} from '../mode-boundaries.mjs';
const own=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const idPattern=/^[a-z][a-z0-9-]{0,63}$/;
const kinds=new Set(['main','side','incident']);
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const text=value=>typeof value==='string'&&value.length>0&&value.length<=800;
function checkPack(pack){
  if(!plain(pack)||typeof pack.id!=='string'||!/^([a-z][a-z0-9-]{0,31})(\.[a-z][a-z0-9-]{0,31})?$/.test(pack.id)||
    !text(pack.title)||!Number.isSafeInteger(pack.version)||pack.version<1||
    !Array.isArray(pack.entries)||pack.entries.length>1500)throw new TypeError('Invalid story pack');
  const seen=new Set();
  for(const item of pack.entries){
    if(!plain(item)||!idPattern.test(item.id)||!kinds.has(item.kind)||seen.has(item.id)||
      !text(item.title)||!text(item.chapter)||!text(item.place)||typeof item.repeatable!=='boolean'||
      !Array.isArray(item.requires)||item.requires.length>20||
      !item.requires.every(id=>seen.has(id))||
      !Array.isArray(item.lines)||item.lines.length<1||item.lines.length>30||
      !item.lines.every(line=>plain(line)&&text(line.speaker)&&text(line.text))||
      !Array.isArray(item.choices)||item.choices.length>6||
      !item.choices.every(c=>plain(c)&&idPattern.test(c.id)&&text(c.label)&&text(c.reply))||
      new Set(item.choices.map(c=>c.id)).size!==item.choices.length ||
      (item.repeatable&&item.kind!=='incident'))throw new TypeError('Invalid story entry: '+String(item?.id));
    seen.add(item.id);
  }
  return pack;
}
export function validateStoryPack(pack){try{checkPack(pack);return true;}catch{return false;}}
function context(progress,pack){
  if(!validateStoryProgress(progress))throw new TypeError('Invalid story save');
  checkPack(pack);
  return progress.packs[pack.id]??null;
}
export function availableStoryEntries(progress,pack,kind='main'){
  const p=context(progress,pack);
  if(!kinds.has(kind))throw new RangeError('Invalid kind');
  const completed=new Set(p?Object.values(p.completed).flat():[]);
  return pack.entries.filter(item=>item.kind===kind&&item.requires.every(id=>completed.has(id))&&
    (!completed.has(item.id)||item.repeatable));
}
export function completedStoryEntries(progress,pack,kind='main'){
  const p=context(progress,pack);
  if(!kinds.has(kind))throw new RangeError('Invalid kind');
  const completed=new Set(p?.completed[kind]??[]);
  return pack.entries.filter(item=>item.kind===kind&&completed.has(item.id));
}
export function completeStoryEntry(progress,pack,id,choiceId=null){
  const p=context(progress,pack);
  const item=pack.entries.find(e=>e.id===id);
  if(!p||!item)throw new RangeError('Unknown story entry or unregistered pack');
  const completed=new Set(Object.values(p.completed).flat());
  if(completed.has(id))return progress; // immutable, one-time completion and no replay rewards
  if(!item.requires.every(required=>completed.has(required)))
    throw new RangeError('Story prerequisites not met');
  if(item.choices.length){
    if(!item.choices.some(c=>c.id===choiceId))throw new RangeError('Invalid choice');
  }else if(choiceId!==null)throw new RangeError('Unexpected choice');
  if(progress.revision===Number.MAX_SAFE_INTEGER)throw new RangeError('Revision exhausted');
  const next=structuredClone(progress);
  const target=next.packs[pack.id];
  target.completed[item.kind].push(item.id);
  target.checkpoint=item.id;
  if(choiceId!==null)target.choices[item.id]=choiceId;
  next.revision++;
  if(!validateStoryProgress(next))throw new RangeError('Story save budget exceeded');
  return next;
}
export function startCoreStory(progress,pack){
  context(progress,pack);
  return registerStoryPack(progress,pack.id);
}
/** Reject impossible Gregorian dates before hashing (UTC/local timezone independent). */
function validLocalCalendarDay(dayKey){
  if(typeof dayKey!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(dayKey))return false;
  const year=Number(dayKey.slice(0,4)),month=Number(dayKey.slice(5,7)),day=Number(dayKey.slice(8,10));
  if(year<1||month<1||month>12)return false;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return day>=1&&day<=days[month-1];
}
/** Deterministic local-day event without server, resources or reroll-on-refresh.
 * This returns one eligible event; a repeatable incident can be reread the next day.
 */
export function dailyStoryIncident(progress,pack,dayKey){
  if(!validLocalCalendarDay(dayKey))
    throw new TypeError('Expected real local calendar day');
  const candidates=availableStoryEntries(progress,pack,'incident');
  // P47: an incident first displayed today stays fixed after mainline unlocks
  // more candidates. A malformed pin is never silently rerolled.
  const pinned=progress.packs[pack.id]?.choices[dailyPinKey(dayKey)];
  if(pinned!==undefined){
    const eligible=candidates.find(item=>item.id===pinned);
    if(eligible)return eligible;
    // A one-off incident can be completed after its daily pin was saved.
    // Keep that exact completed scene readable for the pinned day rather than
    // falsely reporting corruption or rerolling a different incident.
    // An uncompleted, foreign or no-longer-unlocked pin still fails closed.
    const saved=progress.packs[pack.id];
    if(!saved?.completed.incident.includes(pinned))return null;
    const oneOff=pack.entries.find(item=>
      item.id===pinned&&item.kind==='incident'&&!item.repeatable);
    const completed=new Set(Object.values(saved.completed).flat());
    return oneOff&&oneOff.requires.every(id=>completed.has(id))?oneOff:null;
  }
  if(!candidates.length)return null;
  let hash=2166136261;
  for(const char of pack.id+':'+dayKey){hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;}
  return candidates[hash%candidates.length];
}

/** A bounded, schema-v1-compatible selection marker. Stored under the
 * selected pack, never under normal-mode resources or another DLC pack.
 * Only call from the existing locked, exact-raw story save transaction.
 */
const dailyPinKey=dayKey=>'daily-'+dayKey.replaceAll('-','');
export function pinnedDailyStoryIncident(progress,pack,dayKey){
  if(!validLocalCalendarDay(dayKey))throw new TypeError('Expected real local calendar day');
  const p=context(progress,pack);
  return !!p&&own(p.choices,dailyPinKey(dayKey));
}
export function pinDailyStoryIncident(progress,pack,dayKey){
  if(!validLocalCalendarDay(dayKey))throw new TypeError('Expected real local calendar day');
  const p=context(progress,pack);
  if(!p||own(p.choices,dailyPinKey(dayKey)))return progress;
  const selected=dailyStoryIncident(progress,pack,dayKey);
  if(!selected)return progress;
  if(progress.revision===Number.MAX_SAFE_INTEGER)throw new RangeError('Revision exhausted');
  const next=structuredClone(progress);
  const choices=next.packs[pack.id].choices;
  // Keep only today's marker: old daily selections do not accumulate across
  // years or exhaust the existing bounded choices dictionary.
  for(const key of Object.keys(choices))
    if(/^daily-\d{8}$/.test(key))delete choices[key];
  choices[dailyPinKey(dayKey)]=selected.id;
  next.revision++;
  if(!validateStoryProgress(next))throw new RangeError('Story save budget exceeded');
  return next;
}
