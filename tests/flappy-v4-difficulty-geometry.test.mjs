import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Draft-stage geometry audit, not a physical controller or player-success proof.
// Intentionally mirror the game's constants and assert the source contract below.
const source=readFileSync(new URL('../flappy/index.html',import.meta.url),'utf8');
const sourceAnchors=[
 'var s=Math.min(score,45);',
 'speed:W*(.41+s*.0028)',
 'gap:Math.max(H*.205,H*.255-s*.85)',
 'spacing:Math.max(W*.50,W*.60-s*.0018*W)',
 'var marginTop=H*.12+gap*.5;',
 'var marginBottom=groundY-H*.08-gap*.5;',
 'else center=prevGapY+(Math.random()*2-1)*H*.145;',
 'center=clamp(center,marginTop,marginBottom);',
 'function birdRadius(){return Math.max(13,W*.043);}',
 'function pipeWidth(){return clamp(W*.155,48,68);}'
];
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
function difficulty(score,W,H){
 const capped=Math.min(score,45);
 return {
  speed:W*(.41+capped*.0028),
  gap:Math.max(H*.205,H*.255-capped*.85),
  spacing:Math.max(W*.50,W*.60-capped*.0018)
 };
}
function sampleGap(previous,d,H,W,groundY,random){
 const minimum=H*.12+d.gap*.5;
 const maximum=groundY-H*.08-d.gap*.5;
 const proposed=previous===null?H*.42:previous+(random()*2-1)*H*.145;
 return {minimum,maximum,center:clamp(proposed,minimum,maximum)};
}
function pseudoRandom(seed){
 let state=seed>>>0;
 return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}

test('Source geometry constants match audited gameplay code',()=>{
 for(const anchor of sourceAnchors)
  assert.ok(source.includes(anchor),'Gameplay changed; review fairness audit formula: '+anchor);
});

test('Every score up to 100 maintains a usable corridor on four mobile aspect ratios',()=>{
 for(const [W,H] of [[320,568],[360,600],[390,844],[420,740]]){
  const groundY=H*.885;
  const birdRadius=Math.max(13,W*.043);
  let lastSpeed=0,lastGap=Infinity,lastSpacing=Infinity;
  for(let score=0;score<=100;score++){
   const d=difficulty(score,W,H);
   const minY=H*.12+d.gap*.5;
   const maxY=groundY-H*.08-d.gap*.5;
   const usable=d.gap-2*birdRadius;
   assert.ok(minY<maxY,'No legal gap center at score '+score+' viewport '+W+'x'+H);
   assert.ok(usable>=H*.10,'Gap too narrow relative to collision radius');
   assert.ok(d.spacing>d.speed*.75,'Pipes would arrive too rapidly');
   assert.ok(d.gap<=lastGap+1e-7,'Gap must not widen unpredictably');
   assert.ok(d.spacing<=lastSpacing+1e-7,'Spacing must not increase unexpectedly');
   assert.ok(d.speed>=lastSpeed-1e-7,'Speed must not decrease as score rises');
   if(score>=45)assert.equal(d.speed,difficulty(45,W,H).speed,'Speed curve cap changed');
   lastGap=d.gap;lastSpacing=d.spacing;lastSpeed=d.speed;
  }
 }
});

test('Thousands of seeded random obstacle runs respect center bounds and maximum shifts',()=>{
 for(const [W,H] of [[320,568],[360,600],[390,844],[420,740]]){
  for(const seed of [1,3,91,2026,4294967295]){
   const random=pseudoRandom(seed);let previous=null,first=true;
   for(let pipeIndex=0;pipeIndex<300;pipeIndex++){
    const score=Math.min(100,Math.floor(pipeIndex/3));
    const d=difficulty(score,W,H);
    const next=sampleGap(previous,d,H,W,H*.885,random);
    assert.ok(next.center>=next.minimum-1e-6&&next.center<=next.maximum+1e-6,
      'Pipe gap exceeded playfield at '+W+'x'+H+' seed '+seed+' index '+pipeIndex);
    if(!first)
      assert.ok(Math.abs(next.center-previous)<=H*.145+1e-6,'Abrupt adjacent gap shift');
    previous=next.center;first=false;
   }
  }
 }
});
