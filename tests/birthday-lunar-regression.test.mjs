import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {Solar,Lunar,HolidayUtil}=require('../birthday/lunar.js');

test('solar and lunar new years remain calendar-correct across 2024-2026',()=>{
  for(const [year,month,day] of [[2024,2,10],[2025,1,29],[2026,2,17]]){
    const lunar=Solar.fromYmd(year,month,day).getLunar();
    assert.equal(lunar.getMonth(),1);
    assert.equal(lunar.getDay(),1);
    const solar=Lunar.fromYmd(year,1,1).getSolar();
    assert.equal(solar.toYmd(),Solar.fromYmd(year,month,day).toYmd());
  }
});

test('birthday fixture finds each next non-leap lunar birthday in 430 days',()=>{
 const people=[[12,14],[7,14],[1,20]];
 const start=new Date(2026,9,11);
 for(const [targetMonth,targetDay] of people){
   let next=null;
   for(let offset=0;offset<=430;offset++){
     const date=new Date(start);
     date.setDate(start.getDate()+offset);
     const lunar=Solar.fromYmd(date.getFullYear(),date.getMonth()+1,date.getDate()).getLunar();
     if(lunar.getMonth()===targetMonth&&lunar.getDay()===targetDay){
       next=date;break;
     }
   }
   assert.ok(next,`Missing lunar birthday ${targetMonth}/${targetDay}`);
   const lunar=Solar.fromYmd(next.getFullYear(),next.getMonth()+1,next.getDate()).getLunar();
   assert.equal(lunar.getMonth(),targetMonth);
   assert.equal(lunar.getDay(),targetDay);
 }
});

test('holiday reverse target search preserves known mappings',()=>{
 const source=[2024,2025,2026].flatMap(year=>HolidayUtil.getHolidays(year));
 assert.ok(source.length>0,'Expected known holidays from upstream 1.7.7');
 const examples=source.filter(h=>h.getTarget()&&h.getTarget().length>=10).slice(0,30);
 assert.ok(examples.length>0);
 for(const item of examples){
   const reverse=HolidayUtil.getHolidaysByTarget(item.getTarget());
   assert.ok(reverse.some(h=>h.getDay()===item.getDay()),'Missing reverse holiday for '+item.getDay());
 }
});
test('reverse target search rejects missing and overlong suffixes',()=>{
 assert.deepEqual(HolidayUtil.getHolidaysByTarget('99991231'),[]);
 assert.deepEqual(HolidayUtil.getHolidaysByTarget('9'.repeat(200)),[]);
 assert.equal(typeof HolidayUtil.getHoliday(2026,2,17)?.getName(),'string');
});
