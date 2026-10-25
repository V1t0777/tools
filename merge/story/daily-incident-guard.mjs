/** P46: refuse yesterday's or no-longer-selected daily incident at commit time.
 * Pure, read-only guard. Never changes story saves or normal-mode economy.
 */
import {dailyStoryIncident} from './runtime.mjs';

export function canCommitDailyIncident(entry,openedDay,currentDay,progress,pack){
  if(!entry||!pack)return false;
  if(entry.kind!=='incident')return true;
  if(typeof openedDay!=='string'||openedDay!==currentDay)return false;
  try{
    return dailyStoryIncident(progress,pack,currentDay)===entry;
  }catch{
    // Corrupt progress/date/pack must never authorize an incident commit.
    return false;
  }
}
