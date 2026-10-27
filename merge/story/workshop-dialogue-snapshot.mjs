/**
 * Compare the workshop evidence used when a dialogue was opened.
 * An unreadable workshop is not a completed goal; unrelated story scenes
 * remain readable only while the unreadable snapshot stays identical.
 * Pure/read-only: this function never repairs or mutates a save.
 */
export function storyDialogueWorkshopSnapshotCurrent(opened,current){
  if(!opened||!current||typeof opened!=='object'||typeof current!=='object')return false;
  if(opened.blocked===true){
    return current.blocked===true&&current.reason===opened.reason&&
      current.raw===opened.raw;
  }
  if(opened.blocked!==false)return false;
  return current.blocked===false&&current.raw===opened.raw;
}
