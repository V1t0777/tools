(() => {
  'use strict';

  const db = ToolboxAuth.createClient();
  const $ = id => document.getElementById(id);
  const q = v => encodeURIComponent(String(v));
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const median = arr => {
    if(!arr.length) return 0;
    const a=arr.slice().sort((x,y)=>x-y), m=Math.floor(a.length/2);
    return a.length%2?a[m]:(a[m-1]+a[m])/2;
  };
  const escKey = (palette,code) => String(palette||'').trim()+'::'+String(code||'').trim().toUpperCase();

  let session = null;
  let group = null;
  let groupRole = null;
  let inventoryRows = [];
  let inventoryMap = new Map();
  let inventoryPoll = null;

  let imageBitmap = null;
  let workCanvas = document.createElement('canvas');
  let workCtx = workCanvas.getContext('2d',{willReadFrequently:true});
  let cells = [];
  let colorCatalog = new Map();
  let resultItems = [];
  let blankKeys = new Set();
  let highlightKey = null;
  let selectedCellIndex = -1;
  let analysisMeta = null;
  let perspectiveEnabled = false;
  let perspectiveCorners = [{x:.03,y:.03},{x:.97,y:.03},{x:.97,y:.97},{x:.03,y:.97}];
  let perspectiveBackup = null;
  let phaseOffset = {x:0,y:0,score:null};
  let benchmarkState = null;

  const preview = $('previewCanvas');
  const pctx = preview.getContext('2d');
  const els = {
    file:$('fileInput'), cols:$('gridCols'), rows:$('gridRows'), ratio:$('sampleRatio'),
    mode:$('matchMode'), cropL:$('cropLeft'), cropT:$('cropTop'), cropR:$('cropRight'), cropB:$('cropBottom'),
    autoGrid:$('autoGridBtn'), previewGrid:$('previewGridBtn'), analyze:$('analyzeBtn'),
    imageStatus:$('imageStatus'), canvasEmpty:$('canvasEmpty'), paletteCard:$('paletteCard'),
    paletteName:$('paletteName'), delta:$('deltaThreshold'), tolerance:$('clusterTolerance'), paletteText:$('paletteText'),
    paletteStatus:$('paletteStatus'), mardRange:$('mardRange'), mardSeries:$('mardSeries'), mardSearch:$('mardSearch'),
    mardGrid:$('mardGrid'), mardCount:$('mardCount'), mardNote:$('mardNote'),
    beadPitch:$('beadPitch'), sourceMerge:$('sourceMergeTolerance'), targetW:$('targetWidthCm'), targetH:$('targetHeightCm'),
    physicalInfo:$('physicalSizeInfo'), sizeToGrid:$('sizeToGridBtn'),
    phaseMode:$('phaseMode'), backgroundTol:$('backgroundTolerance'), expectedColors:$('expectedColors'),
    perspectiveMode:$('perspectiveMode'), openPerspective:$('openPerspectiveBtn'), resetPerspective:$('resetPerspectiveBtn'),
    perspectiveEditor:$('perspectiveEditor'), perspectiveCanvas:$('perspectiveCanvas'), applyPerspective:$('applyPerspectiveBtn'), cancelPerspective:$('cancelPerspectiveBtn'),
    phaseStatus:$('phaseStatus'),
    limitPalette:$('limitPaletteEnabled'), projectPaletteCodes:$('projectPaletteCodes'), projectPaletteStatus:$('projectPaletteStatus'), paletteFromInventory:$('paletteFromInventoryBtn'),
    resultBody:$('resultBody'), autoBlank:$('autoBlank'),
    diagGeometry:$('diagGeometry'), diagPerspective:$('diagPerspective'), diagSource:$('diagSource'), diagBackground:$('diagBackground'),
    diagAmbiguous:$('diagAmbiguous'), diagUnknown:$('diagUnknown'), diagnosticList:$('diagnosticList'),
    runBenchmark:$('runBenchmarkBtn'), benchmarkResult:$('benchmarkResult'),
    auditCells:$('auditCells'), auditBeads:$('auditBeads'), auditBlank:$('auditBlank'), auditLow:$('auditLow'),
    integrity:$('integrity'), quality:$('qualityBadge'), resultSub:$('resultSub'),
    cellEditor:$('cellEditor'), cellLabel:$('cellLabel'), cellConfidence:$('cellConfidence'), cellSelect:$('cellColorSelect'),
    projectTitle:$('projectTitle'), projectScope:$('projectScope'), projectStatus:$('projectStatus'),
    invScope:$('inventoryScope'), invIdentity:$('inventoryIdentity'), invBody:$('inventoryBody'),
    invPalette:$('invPalette'), invCode:$('invCode'), invName:$('invName'), invHex:$('invHex'), invQty:$('invQty'),
    invStatus:$('inventoryStatus'), eventList:$('eventList'), projectList:$('projectList')
  };

  function setStatus(el,msg,type=''){
    el.textContent=msg||'';
    el.classList.toggle('error',type==='error');
  }
  function create(tag,cls,text){
    const el=document.createElement(tag);
    if(cls) el.className=cls;
    if(text!==undefined) el.textContent=text;
    return el;
  }
  function btn(text,cls='micro'){
    const b=create('button',cls,text); b.type='button'; return b;
  }
  function formatTime(v){
    try{return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
    catch{return String(v||'');}
  }

  // ---------- Auth / cloud ----------
  async function refreshAuthUI(){
    const {data}=await db.auth.getSession();
    session=data?.session||null;
    if(!session){
      group=null;groupRole=null;
      $('loginForm').classList.remove('hidden');
      $('loggedActions').classList.add('hidden');
      $('loginTitle').textContent='本地识别可直接使用';
      $('loginDesc').textContent='登录后可同步个人库存、饭醉拼豆库和项目记录。';
      $('cloudState').innerHTML='<span class="dot local"></span><span>本地模式</span>';
      els.invIdentity.textContent='未登录';
      inventoryRows=[];inventoryMap.clear();
      renderInventory();renderResults();
      return;
    }
    $('loginForm').classList.add('hidden');
    $('loggedActions').classList.remove('hidden');
    $('loggedUser').textContent=session.user?.email||'已登录';
    $('loginTitle').textContent='云端同步已启用';
    $('loginDesc').textContent='个人库存仅自己可见；共享库存按组权限开放。';
    $('cloudState').innerHTML='<span class="dot online"></span><span>云端已连接</span>';
    await loadGroup();
    await loadInventory();
  }

  async function loadGroup(){
    group=null;groupRole=null;
    if(!session) return;
    try{
      const rows=await ToolboxAuth.rest('bead_group_members?select=group_id,display_name,role&user_id=eq.'+q(session.user.id)+'&limit=1');
      if(rows?.length){
        groupRole=rows[0].role;
        const groups=await ToolboxAuth.rest('bead_groups?select=id,name&id=eq.'+q(rows[0].group_id)+'&limit=1');
        if(groups?.length) group=groups[0];
      }
      els.invIdentity.textContent=group ? ('共享组：'+group.name+' · '+groupRole) : '仅个人库存';
      els.projectScope.querySelector('option[value="group"]').disabled=!group;
      els.invScope.querySelector('option[value="group"]').disabled=!group;
      if(!group && els.invScope.value==='group') els.invScope.value='personal';
    }catch(err){
      console.warn(err);
      els.invIdentity.textContent='共享组加载失败';
    }
  }

  $('loginForm').addEventListener('submit',async e=>{
    e.preventDefault();$('loginError').textContent='';
    const email=$('loginEmail').value.trim(),password=$('loginPassword').value;
    const {error}=await db.auth.signInWithPassword({email,password});
    if(error){$('loginError').textContent=ToolboxAuth.authMessage(error);return;}
    $('loginPassword').value='';
    await refreshAuthUI();
  });
  $('logoutBtn').addEventListener('click',async()=>{await db.auth.signOut();await refreshAuthUI();});
  db.auth.onAuthStateChange(()=>setTimeout(refreshAuthUI,0));

  // ---------- Tabs ----------
  document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===t));
    document.querySelectorAll('.tab-panel').forEach(x=>x.classList.toggle('active',x.id==='tab-'+t.dataset.tab));
    if(t.dataset.tab==='inventory' && session) loadInventory();
    if(t.dataset.tab==='projects' && session) loadProjects();
  }));
  function switchTab(name){
    const t=document.querySelector('.tab[data-tab="'+name+'"]'); if(t) t.click();
  }

  // ---------- Color science ----------
  function hexToRgb(hex){
    const h=String(hex).replace('#','');
    if(!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];
  }
  function rgbToHex(r,g,b){
    const h=v=>clamp(Math.round(v),0,255).toString(16).padStart(2,'0').toUpperCase();
    return '#'+h(r)+h(g)+h(b);
  }
  function rgbToLab(rgb){
    let [r,g,b]=rgb.map(v=>v/255);
    r=r<=.04045?r/12.92:Math.pow((r+.055)/1.055,2.4);
    g=g<=.04045?g/12.92:Math.pow((g+.055)/1.055,2.4);
    b=b<=.04045?b/12.92:Math.pow((b+.055)/1.055,2.4);
    let x=(r*.4124564+g*.3575761+b*.1804375)/.95047;
    let y=(r*.2126729+g*.7151522+b*.0721750)/1;
    let z=(r*.0193339+g*.1191920+b*.9503041)/1.08883;
    const f=t=>t>.008856?Math.cbrt(t):(7.787*t+16/116);
    x=f(x);y=f(y);z=f(z);
    return [116*y-16,500*(x-y),200*(y-z)];
  }
  function dE00(lab1,lab2){
    const [L1,a1,b1]=lab1,[L2,a2,b2]=lab2;
    const C1=Math.hypot(a1,b1),C2=Math.hypot(a2,b2),Cbar=(C1+C2)/2;
    const G=.5*(1-Math.sqrt(Math.pow(Cbar,7)/(Math.pow(Cbar,7)+Math.pow(25,7))));
    const ap1=(1+G)*a1,ap2=(1+G)*a2;
    const Cp1=Math.hypot(ap1,b1),Cp2=Math.hypot(ap2,b2);
    const hp=(a,b)=>{let h=Math.atan2(b,a)*180/Math.PI;return h<0?h+360:h};
    const h1=hp(ap1,b1),h2=hp(ap2,b2);
    const dLp=L2-L1,dCp=Cp2-Cp1;
    let dh=h2-h1;
    if(Cp1*Cp2===0) dh=0;
    else if(dh>180) dh-=360;
    else if(dh<-180) dh+=360;
    const dHp=2*Math.sqrt(Cp1*Cp2)*Math.sin((dh*Math.PI/180)/2);
    const Lbar=(L1+L2)/2,Cpbar=(Cp1+Cp2)/2;
    let hbar;
    if(Cp1*Cp2===0) hbar=h1+h2;
    else if(Math.abs(h1-h2)<=180) hbar=(h1+h2)/2;
    else hbar=(h1+h2<360)?(h1+h2+360)/2:(h1+h2-360)/2;
    const rad=x=>x*Math.PI/180;
    const T=1-.17*Math.cos(rad(hbar-30))+.24*Math.cos(rad(2*hbar))+.32*Math.cos(rad(3*hbar+6))-.20*Math.cos(rad(4*hbar-63));
    const dTheta=30*Math.exp(-Math.pow((hbar-275)/25,2));
    const Rc=2*Math.sqrt(Math.pow(Cpbar,7)/(Math.pow(Cpbar,7)+Math.pow(25,7)));
    const Sl=1+(.015*Math.pow(Lbar-50,2))/Math.sqrt(20+Math.pow(Lbar-50,2));
    const Sc=1+.045*Cpbar,Sh=1+.015*Cpbar*T;
    const Rt=-Math.sin(rad(2*dTheta))*Rc;
    const a=dLp/Sl,b=dCp/Sc,c=dHp/Sh;
    return Math.sqrt(a*a+b*b+c*c+Rt*b*c);
  }

  function parseProjectPaletteCodes(){
    return new Set(
      String(els.projectPaletteCodes?.value||'')
        .toUpperCase()
        .split(/[\s,，;；]+/)
        .map(x=>x.trim())
        .filter(Boolean)
    );
  }
  function updateProjectPaletteStatus(){
    const codes=parseProjectPaletteCodes();
    const enabled=!!els.limitPalette?.checked;
    els.projectPaletteStatus.textContent=enabled
      ? (codes.size ? ('限定 '+codes.size+' 个 MARD 色号') : '已启用限定，但尚未填写色号')
      : '未限制：在当前 MARD 色库中匹配';
  }
  function getMardPalette(mode='mard221'){
    const source=globalThis.MARDPalette?.colors||[];
    const full=mode==='mard291';
    const limited=!!els.limitPalette?.checked;
    const allowed=parseProjectPaletteCodes();
    return source
      .filter(x=>(full||x.standard) && (!limited || !allowed.size || allowed.has(x.code.toUpperCase())))
      .map(x=>{
        const rgb=hexToRgb(x.hex);
        return {
          key:x.code,
          code:x.code,
          name:'MARD '+x.code+(x.special?.name?' · '+x.special.name:''),
          hex:x.hex.toUpperCase(),
          rgb,
          lab:rgbToLab(rgb),
          series:x.series,
          special:x.special||null
        };
      });
  }

  function initMardPalette(){
    if(!globalThis.MARDPalette){
      els.mardNote.textContent='MARD 色卡数据未加载。';
      return;
    }
    els.mardSeries.textContent='';
    const all=create('option');all.value='all';all.textContent='全部系列';els.mardSeries.append(all);
    for(const s of MARDPalette.seriesOrder){
      const op=create('option');op.value=s;
      const count=MARDPalette.colors.filter(x=>x.series===s).length;
      op.textContent=s+' 系列 · '+count+' 色';
      els.mardSeries.append(op);
    }
    renderMardPalette();
  }

  function renderMardPalette(){
    if(!globalThis.MARDPalette) return;
    const full=els.mardRange.value==='291';
    const series=els.mardSeries.value||'all';
    const needle=els.mardSearch.value.trim().toUpperCase().replace('#','');
    let rows=MARDPalette.colors.filter(x=>full||x.standard);
    if(series!=='all') rows=rows.filter(x=>x.series===series);
    if(needle) rows=rows.filter(x=>x.code.includes(needle)||x.hex.replace('#','').includes(needle));
    els.mardGrid.textContent='';
    for(const item of rows){
      const card=create('div','mard-color-card');
      card.title=item.special?.note||item.hex;
      const sw=create('span','mard-swatch');sw.style.background=item.hex;
      const info=create('span','mard-color-info');
      info.append(create('b','',item.code),create('small','',item.hex+(item.special?.name?' · '+item.special.name:'')));
      card.append(sw,info);
      card.addEventListener('click',()=>{
        els.invPalette.value=full?'MARD 291 (2026)':'MARD 221 (2026)';
        els.invCode.value=item.code;
        els.invName.value='MARD '+item.code+(item.special?.name?' · '+item.special.name:'');
        els.invHex.value=item.hex;
        els.invQty.value=inventoryMap.get(escKey(els.invPalette.value,item.code))?.quantity||0;
        setStatus(els.imageStatus,'已选择 '+item.code+' '+item.hex+'；如需维护库存，可进入“库存”页。');
      });
      els.mardGrid.append(card);
    }
    const base=full?MARDPalette.totalCount:MARDPalette.standardCount;
    els.mardCount.textContent='显示 '+rows.length+' / '+base+' 色';
    if(full){
      els.mardNote.textContent='完整 291 色包含 P/Q/R/T/Y/ZG 特殊系列。识别时会标记这些匹配为“待确认”，因为特殊材质效果不能由单一 HEX 完整表达。';
    }else{
      els.mardNote.textContent='标准 221 色覆盖 A–H 与 M，适合普通实色图纸，也是默认识别范围。';
    }
  }

  function parsePalette(){
    const lines=els.paletteText.value.split(/\r?\n/);
    const out=[],seen=new Set();
    for(const raw of lines){
      const line=raw.trim();if(!line) continue;
      const parts=line.split(',').map(s=>s.trim());
      if(parts.length<2) continue;
      const code=parts[0].toUpperCase(),hex=parts[1].toUpperCase(),name=parts.slice(2).join(',')||code;
      const rgb=hexToRgb(hex);
      if(!code||!rgb||seen.has(code)) continue;
      seen.add(code);out.push({key:code,code,name,hex:rgbToHex(...rgb),rgb,lab:rgbToLab(rgb)});
    }
    return out;
  }
  function savePaletteLocal(){
    const parsed=parsePalette();
    try{localStorage.setItem('beadPalette.v1',JSON.stringify({name:els.paletteName.value.trim()||'我的色卡',text:els.paletteText.value}));}catch{}
    els.paletteStatus.textContent=parsed.length ? ('已保存 '+parsed.length+' 个颜色') : '未识别到有效色卡行';
  }
  function loadPaletteLocal(){
    try{
      const v=JSON.parse(localStorage.getItem('beadPalette.v1')||'null');
      if(v){els.paletteName.value=v.name||'我的色卡';els.paletteText.value=v.text||'';}
    }catch{}
    const n=parsePalette().length;els.paletteStatus.textContent=n?('已载入 '+n+' 个颜色'):'当前未载入自定义色卡';
  }
  $('savePaletteBtn').addEventListener('click',savePaletteLocal);
  els.mardRange.addEventListener('change',()=>{
    els.mode.value=els.mardRange.value==='291'?'mard291':'mard221';
    renderMardPalette();
  });
  els.mardSeries.addEventListener('change',renderMardPalette);
  els.mardSearch.addEventListener('input',renderMardPalette);
  els.limitPalette.addEventListener('change',updateProjectPaletteStatus);
  els.projectPaletteCodes.addEventListener('input',updateProjectPaletteStatus);
  els.paletteFromInventory.addEventListener('click',()=>{
    const codes=[...new Set(inventoryRows
      .filter(r=>Number(r.quantity)>0 && /^MARD\b/i.test(String(r.palette_name||'')))
      .map(r=>String(r.color_code||'').toUpperCase())
      .filter(Boolean))].sort();
    if(!codes.length){
      setStatus(els.imageStatus,'当前库存里没有可用于限定的 MARD 有货色号。','error');
      return;
    }
    els.projectPaletteCodes.value=codes.join(',');
    els.limitPalette.checked=true;
    updateProjectPaletteStatus();
    setStatus(els.imageStatus,'已从当前库存生成项目限定色板，共 '+codes.length+' 个色号。');
  });
  els.mode.addEventListener('change',()=>{
    els.paletteCard.classList.toggle('palette-required',els.mode.value==='palette');
    if(els.mode.value==='mard221'){els.mardRange.value='221';renderMardPalette();}
    if(els.mode.value==='mard291'){els.mardRange.value='291';renderMardPalette();}
    if(els.mode.value==='palette' && !parsePalette().length) setStatus(els.imageStatus,'自定义色卡模式需要先填写“色号,#RRGGBB,名称”。','error');
  });

  function updatePhysicalInfo(){
    const pitch=clamp(Number(els.beadPitch.value)||2.6,2,4);
    const cols=clamp(parseInt(els.cols.value)||1,1,300),rows=clamp(parseInt(els.rows.value)||1,1,300);
    const w=cols*pitch/10,h=rows*pitch/10;
    els.physicalInfo.textContent='当前 '+cols+' × '+rows+' 格 ≈ '+w.toFixed(2)+' × '+h.toFixed(2)+' cm（按 '+pitch.toFixed(2)+' mm 名义间距）';
  }
  function applyTargetSize(){
    const pitch=clamp(Number(els.beadPitch.value)||2.6,2,4);
    const w=Number(els.targetW.value),h=Number(els.targetH.value);
    let changed=false;
    if(Number.isFinite(w)&&w>0){els.cols.value=clamp(Math.round(w*10/pitch),1,300);changed=true;}
    if(Number.isFinite(h)&&h>0){els.rows.value=clamp(Math.round(h*10/pitch),1,300);changed=true;}
    updatePhysicalInfo();
    if(changed&&imageBitmap){prepareWorkCanvas();renderPreview(true);}
    setStatus(els.imageStatus,changed?'已按 '+pitch.toFixed(2)+' mm 换算目标尺寸；请用网格预览确认与图纸实际格数一致。':'请至少填写一个目标宽度或高度。',changed?'':'error');
  }
  [els.cols,els.rows,els.beadPitch].forEach(el=>el.addEventListener('input',updatePhysicalInfo));
  els.sizeToGrid.addEventListener('click',applyTargetSize);

  // ---------- Precision geometry ----------
  function solveLinear(A,b){
    const n=b.length,M=A.map((row,i)=>row.slice().concat(b[i]));
    for(let col=0;col<n;col++){
      let pivot=col;
      for(let r=col+1;r<n;r++) if(Math.abs(M[r][col])>Math.abs(M[pivot][col])) pivot=r;
      if(Math.abs(M[pivot][col])<1e-10) return null;
      [M[col],M[pivot]]=[M[pivot],M[col]];
      const div=M[col][col];
      for(let j=col;j<=n;j++) M[col][j]/=div;
      for(let r=0;r<n;r++){
        if(r===col) continue;
        const factor=M[r][col];
        if(!factor) continue;
        for(let j=col;j<=n;j++) M[r][j]-=factor*M[col][j];
      }
    }
    return M.map(row=>row[n]);
  }

  function homographyDestToSrc(dst,src){
    const A=[],b=[];
    for(let i=0;i<4;i++){
      const x=dst[i].x,y=dst[i].y,u=src[i].x,v=src[i].y;
      A.push([x,y,1,0,0,0,-u*x,-u*y]); b.push(u);
      A.push([0,0,0,x,y,1,-v*x,-v*y]); b.push(v);
    }
    const h=solveLinear(A,b);
    return h ? [...h,1] : null;
  }

  function applyH(H,x,y){
    const d=H[6]*x+H[7]*y+H[8];
    return {x:(H[0]*x+H[1]*y+H[2])/d,y:(H[3]*x+H[4]*y+H[5])/d};
  }

  function rawSourceCanvas(maxDim=1800){
    const s=document.createElement('canvas');
    const scale=Math.min(1,maxDim/Math.max(imageBitmap.width,imageBitmap.height));
    s.width=Math.max(1,Math.round(imageBitmap.width*scale));
    s.height=Math.max(1,Math.round(imageBitmap.height*scale));
    const x=s.getContext('2d',{willReadFrequently:true});
    x.imageSmoothingEnabled=false;
    x.drawImage(imageBitmap,0,0,s.width,s.height);
    return {canvas:s,scale};
  }

  function perspectiveRectify(maxDim=1800){
    if(!imageBitmap||!perspectiveEnabled) return null;
    const raw=rawSourceCanvas(maxDim);
    const pts=perspectiveCorners.map(p=>({x:p.x*(raw.canvas.width-1),y:p.y*(raw.canvas.height-1)}));
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    let ow=Math.max(64,Math.round((dist(pts[0],pts[1])+dist(pts[3],pts[2]))/2));
    let oh=Math.max(64,Math.round((dist(pts[0],pts[3])+dist(pts[1],pts[2]))/2));
    const scale=Math.min(1,maxDim/Math.max(ow,oh));ow=Math.max(64,Math.round(ow*scale));oh=Math.max(64,Math.round(oh*scale));
    const dst=[{x:0,y:0},{x:ow-1,y:0},{x:ow-1,y:oh-1},{x:0,y:oh-1}];
    const H=homographyDestToSrc(dst,pts); if(!H) return null;
    const srcCtx=raw.canvas.getContext('2d',{willReadFrequently:true});
    const src=srcCtx.getImageData(0,0,raw.canvas.width,raw.canvas.height);
    const out=document.createElement('canvas');out.width=ow;out.height=oh;
    const ox=out.getContext('2d',{willReadFrequently:true});
    const od=ox.createImageData(ow,oh),sd=src.data,dd=od.data,sw=raw.canvas.width,sh=raw.canvas.height;
    for(let y=0;y<oh;y++){
      for(let x=0;x<ow;x++){
        const p=applyH(H,x,y);
        const sx=clamp(Math.round(p.x),0,sw-1),sy=clamp(Math.round(p.y),0,sh-1);
        const si=(sy*sw+sx)*4,di=(y*ow+x)*4;
        dd[di]=sd[si];dd[di+1]=sd[si+1];dd[di+2]=sd[si+2];dd[di+3]=sd[si+3];
      }
    }
    ox.putImageData(od,0,0);
    return out;
  }

  function renderPerspectiveEditor(){
    if(!imageBitmap)return;
    const cv=els.perspectiveCanvas,ctx=cv.getContext('2d');
    const maxW=900,maxH=650,scale=Math.min(maxW/imageBitmap.width,maxH/imageBitmap.height,1);
    cv.width=Math.max(240,Math.round(imageBitmap.width*scale));cv.height=Math.max(180,Math.round(imageBitmap.height*scale));
    ctx.clearRect(0,0,cv.width,cv.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(imageBitmap,0,0,cv.width,cv.height);
    ctx.strokeStyle='rgba(139,102,255,.95)';ctx.lineWidth=Math.max(2,cv.width/350);ctx.beginPath();
    perspectiveCorners.forEach((p,i)=>{const x=p.x*cv.width,y=p.y*cv.height;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.closePath();ctx.stroke();
    perspectiveCorners.forEach((p,i)=>{
      const x=p.x*cv.width,y=p.y*cv.height;
      ctx.fillStyle='#7656e8';ctx.beginPath();ctx.arc(x,y,Math.max(10,cv.width/55),0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#fff';ctx.font='bold '+Math.max(12,cv.width/48)+'px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);
    });
  }

  let dragCorner=-1;
  els.perspectiveCanvas.addEventListener('pointerdown',e=>{
    const r=els.perspectiveCanvas.getBoundingClientRect();
    const x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    let best=Infinity,idx=-1;
    perspectiveCorners.forEach((p,i)=>{const d=Math.hypot(x-p.x,y-p.y);if(d<best){best=d;idx=i;}});
    if(best<.12){dragCorner=idx;els.perspectiveCanvas.setPointerCapture?.(e.pointerId);}
  });
  els.perspectiveCanvas.addEventListener('pointermove',e=>{
    if(dragCorner<0)return;
    const r=els.perspectiveCanvas.getBoundingClientRect();
    perspectiveCorners[dragCorner]={x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)};
    renderPerspectiveEditor();
  });
  const stopDrag=()=>{dragCorner=-1;};
  els.perspectiveCanvas.addEventListener('pointerup',stopDrag);els.perspectiveCanvas.addEventListener('pointercancel',stopDrag);

  els.openPerspective.addEventListener('click',()=>{
    if(!imageBitmap){setStatus(els.imageStatus,'请先上传图纸，再设置四角。','error');return;}
    perspectiveBackup=perspectiveCorners.map(p=>({...p}));
    els.perspectiveEditor.classList.remove('hidden');renderPerspectiveEditor();
  });
  els.resetPerspective.addEventListener('click',()=>{
    perspectiveCorners=[{x:.03,y:.03},{x:.97,y:.03},{x:.97,y:.97},{x:.03,y:.97}];
    perspectiveEnabled=false;els.perspectiveMode.value='off';els.perspectiveEditor.classList.add('hidden');
    if(imageBitmap){prepareWorkCanvas();renderPreview(true);}
  });
  els.applyPerspective.addEventListener('click',()=>{
    perspectiveEnabled=true;els.perspectiveMode.value='manual';els.perspectiveEditor.classList.add('hidden');
    prepareWorkCanvas();renderPreview(true);setStatus(els.imageStatus,'四角透视校正已应用。请继续确认网格是否对齐。');
  });
  els.cancelPerspective.addEventListener('click',()=>{
    if(perspectiveBackup)perspectiveCorners=perspectiveBackup.map(p=>({...p}));
    els.perspectiveEditor.classList.add('hidden');
  });
  els.perspectiveMode.addEventListener('change',()=>{
    if(els.perspectiveMode.value==='off'){perspectiveEnabled=false;if(imageBitmap){prepareWorkCanvas();renderPreview(true);}}
    else if(imageBitmap){els.openPerspective.click();}
  });

  function fastVariance(data,w,h,cx,cy,rx,ry){
    const vals=[];
    for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++){
      const x=clamp(Math.round(cx+xx*rx),0,w-1),y=clamp(Math.round(cy+yy*ry),0,h-1);
      vals.push(grayAt(data,w,x,y));
    }
    const m=vals.reduce((a,b)=>a+b,0)/vals.length;
    return vals.reduce((s,v)=>s+(v-m)*(v-m),0)/vals.length;
  }

  function findGridPhase(data,w,h,cols,rows){
    if(els.phaseMode.value!=='auto')return{x:0,y:0,score:null};
    const cw=w/cols,ch=h/rows,steps=[-.32,-.24,-.16,-.08,0,.08,.16,.24,.32];
    let best={x:0,y:0,score:Infinity};
    const rowStep=Math.max(1,Math.floor(rows/12)),colStep=Math.max(1,Math.floor(cols/12));
    for(const oy of steps)for(const ox of steps){
      let score=0,n=0;
      for(let r=0;r<rows;r+=rowStep)for(let col=0;col<cols;col+=colStep){
        const cx=(col+.5+ox)*cw,cy=(r+.5+oy)*ch;
        score+=fastVariance(data,w,h,cx,cy,Math.max(1,cw*.12),Math.max(1,ch*.12));n++;
      }
      score/=Math.max(1,n);
      if(score<best.score)best={x:ox,y:oy,score};
    }
    return best;
  }

  function rebuildClustersFromCells(raw){
    const map=new Map();
    for(const cell of raw){
      if(cell.alpha<40||cell.sourceCluster==null)continue;
      let cl=map.get(cell.sourceCluster);
      if(!cl){cl={id:cell.sourceCluster,count:0,sum:[0,0,0],cells:[]};map.set(cell.sourceCluster,cl);}
      cl.count++;cl.sum[0]+=cell.rgb[0];cl.sum[1]+=cell.rgb[1];cl.sum[2]+=cell.rgb[2];cl.cells.push(cell);
    }
    return [...map.values()].map(cl=>{cl.rgb=cl.sum.map(v=>v/cl.count);cl.lab=rgbToLab(cl.rgb);cl.hex=rgbToHex(...cl.rgb);return cl;}).sort((a,b)=>b.count-a.count);
  }

  function mergeClusterInto(from,to){
    for(const cell of from.cells)cell.sourceCluster=to.id;
  }

  function spatialRefineClusters(raw,clusters,cols,rows,tolerance){
    const byId=new Map(clusters.map(x=>[x.id,x])),total=raw.length;
    const tiny=Math.max(2,Math.round(total*.004));
    for(const cl of clusters.slice().sort((a,b)=>a.count-b.count)){
      if(cl.count>tiny)continue;
      const votes=new Map();
      for(const cell of cl.cells){
        const idx=cell.row*cols+cell.col;
        const neighbors=[idx-cols,idx+cols,idx-1,idx+1];
        for(const ni of neighbors){
          const n=raw[ni];if(!n)continue;
          if(Math.abs(n.row-cell.row)+Math.abs(n.col-cell.col)!==1)continue;
          if(n.sourceCluster!=null&&n.sourceCluster!==cl.id)votes.set(n.sourceCluster,(votes.get(n.sourceCluster)||0)+1);
        }
      }
      const targets=[...votes.entries()].sort((a,b)=>b[1]-a[1]);
      if(!targets.length)continue;
      const target=byId.get(targets[0][0]);if(!target)continue;
      if(dE00(cl.lab,target.lab)<=tolerance*1.55)mergeClusterInto(cl,target);
    }
    return rebuildClustersFromCells(raw);
  }

  function constrainClusterCount(raw,clusters,expected){
    expected=clamp(parseInt(expected)||0,0,100);
    if(!expected||clusters.length<=expected)return clusters;
    let list=clusters;
    while(list.length>expected){
      let best=null,bestD=Infinity;
      for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
        const d=dE00(list[i].lab,list[j].lab);
        if(d<bestD){bestD=d;best=[list[i],list[j]];}
      }
      if(!best||bestD>7.5)break;
      const [a,b]=best;a.count>=b.count?mergeClusterInto(b,a):mergeClusterInto(a,b);
      list=rebuildClustersFromCells(raw);
    }
    return list;
  }

  function clusterSourceCells(raw,tolerance){
    const exact=new Map();
    for(const cell of raw){
      if(cell.alpha<40) continue;
      let g=exact.get(cell.hex);
      if(!g){g={hex:cell.hex,count:0,rgb:[0,0,0],lab:cell.lab,cells:[]};exact.set(cell.hex,g);}
      g.count++;g.cells.push(cell);
      g.rgb[0]+=cell.rgb[0];g.rgb[1]+=cell.rgb[1];g.rgb[2]+=cell.rgb[2];
    }
    const groups=[...exact.values()];
    for(const g of groups){
      g.rgb=g.rgb.map(v=>v/g.count);g.lab=rgbToLab(g.rgb);
    }
    groups.sort((a,b)=>b.count-a.count);
    const clusters=[];
    let seq=0;
    for(const g of groups){
      let best=null,bestD=Infinity;
      for(const cl of clusters){
        const d=dE00(g.lab,cl.lab);
        if(d<bestD){bestD=d;best=cl;}
      }
      if(!best||bestD>tolerance){
        best={id:++seq,count:0,sum:[0,0,0],rgb:g.rgb.slice(),lab:g.lab,cells:[],hex:g.hex};
        clusters.push(best);
      }
      best.count+=g.count;
      best.sum[0]+=g.rgb[0]*g.count;best.sum[1]+=g.rgb[1]*g.count;best.sum[2]+=g.rgb[2]*g.count;
      best.rgb=best.sum.map(v=>v/best.count);best.lab=rgbToLab(best.rgb);best.hex=rgbToHex(...best.rgb);
      for(const cell of g.cells){cell.sourceCluster=best.id;best.cells.push(cell);}
    }
    return clusters;
  }

  function findBorderBlankKey(list,cols,rows){
    const border=list.filter(c=>c.row===0||c.col===0||c.row===rows-1||c.col===cols-1);
    if(!border.length) return null;
    const counts=new Map();
    for(const c of border) counts.set(c.key,(counts.get(c.key)||0)+1);
    let key=null,n=0;counts.forEach((v,k)=>{if(v>n){n=v;key=k;}});
    if(!key) return null;
    const corners=[
      list.find(c=>c.row===0&&c.col===0),
      list.find(c=>c.row===0&&c.col===cols-1),
      list.find(c=>c.row===rows-1&&c.col===0),
      list.find(c=>c.row===rows-1&&c.col===cols-1)
    ].filter(Boolean);
    const cornerHits=corners.filter(c=>c.key===key).length;
    const share=n/border.length;
    return share>=0.60&&cornerHits>=3?key:null;
  }

  function rankPalette(lab,palette,limit=3){
    return palette
      .map(p=>({key:p.key,code:p.code,name:p.name,hex:p.hex,special:p.special||null,delta:dE00(lab,p.lab)}))
      .sort((a,b)=>a.delta-b.delta)
      .slice(0,limit);
  }

  function detectConnectedBackground(list,cols,rows,tolerance){
    list.forEach(c=>{c.autoBlank=false;});
    if(!list.length)return {count:0,seed:null};
    const corners=[0,cols-1,(rows-1)*cols,rows*cols-1].map(i=>list[i]).filter(Boolean);
    if(corners.length<2)return {count:0,seed:null};
    let seed=corners[0],bestN=0;
    for(const candidate of corners){
      const n=corners.filter(x=>dE00(candidate.lab,x.lab)<=tolerance).length;
      if(n>bestN){bestN=n;seed=candidate;}
    }
    if(bestN<2)return {count:0,seed:null};
    const q=[],seen=new Uint8Array(list.length);
    for(let i=0;i<list.length;i++){
      const cell=list[i];
      if(cell.row===0||cell.col===0||cell.row===rows-1||cell.col===cols-1){
        if(dE00(cell.lab,seed.lab)<=tolerance){q.push(i);seen[i]=1;}
      }
    }
    let count=0;
    while(q.length){
      const i=q.shift(),cell=list[i];
      if(dE00(cell.lab,seed.lab)>tolerance*1.2)continue;
      cell.autoBlank=true;count++;
      const next=[i-cols,i+cols,i-1,i+1];
      for(const ni of next){
        if(ni<0||ni>=list.length||seen[ni])continue;
        const n=list[ni];
        if(Math.abs(n.row-cell.row)+Math.abs(n.col-cell.col)!==1)continue;
        if(dE00(n.lab,seed.lab)<=tolerance || dE00(n.lab,cell.lab)<=tolerance*.8){seen[ni]=1;q.push(ni);}
      }
    }
    return {count,seed:seed.hex};
  }

  function isCellBlank(c){return !!c.autoBlank || blankKeys.has(c.key);}

  function updateDiagnostics(){
    if(!analysisMeta||!cells.length){
      els.diagGeometry.textContent='等待分析';els.diagPerspective.textContent=perspectiveEnabled?'已启用':'未启用';
      els.diagSource.textContent='—';els.diagBackground.textContent='—';els.diagAmbiguous.textContent='—';els.diagUnknown.textContent='—';
      els.diagnosticList.innerHTML='<div class="empty-note">分析后这里会给出针对本张图纸的误差诊断。</div>';return;
    }
    const nonBlank=cells.filter(c=>!isCellBlank(c));
    const ambiguous=nonBlank.filter(c=>c.ambiguous).length;
    const unknown=nonBlank.filter(c=>String(c.key).startsWith('__unknown_')).length;
    const bg=cells.filter(c=>isCellBlank(c)).length;
    els.diagGeometry.textContent=(analysisMeta.phaseScore==null?'固定居中':'相位 '+analysisMeta.phaseX.toFixed(2)+' / '+analysisMeta.phaseY.toFixed(2));
    els.diagPerspective.textContent=analysisMeta.perspective?'四角校正已用':'未启用';
    els.diagSource.textContent=analysisMeta.sourceRawColorCount+' → '+analysisMeta.sourceColorCount+' 色';
    els.diagBackground.textContent=bg+' 格';
    els.diagAmbiguous.textContent=ambiguous+' 格';
    els.diagUnknown.textContent=unknown+' 格';
    els.diagnosticList.textContent='';
    const add=(type,msg)=>els.diagnosticList.append(create('div','diag-item '+type,msg));
    if(analysisMeta.phaseScore!=null)add('good','已自动搜索网格 X/Y 采样相位，减少采样落到网格线或相邻色块的概率。');
    else add('info','当前使用固定居中采样；若图纸网格有边距或偏移，建议开启自动相位。');
    if(perspectiveEnabled)add('good','已使用四角透视拉正，适合手机拍照或斜拍图纸。');
    else add('info','未启用透视校正；标准截图通常不需要，拍照图建议开启。');
    if(analysisMeta.sourceRawColorCount>analysisMeta.sourceColorCount*1.6)add('good','源色已明显收敛：压缩/抗锯齿产生的近似色被合并。');
    if(ambiguous)add('warn','有 '+ambiguous+' 格最佳与次佳 MARD 色号过近，请重点复核 Top-3 候选。');
    if(unknown)add('bad','有 '+unknown+' 格超过 ΔE00 拒识阈值，没有强制塞入 MARD 色号。');
    if(bg)add('good','连通背景分割识别 '+bg+' 格，只从边缘/角落向内扩散，不会全局删除同色孤立区域。');
    const expected=Number(els.expectedColors.value)||0;
    if(expected&&analysisMeta.sourceColorCount!==expected)add('info','期望颜色数为 '+expected+'，算法只会合并足够接近的色群，不会为了凑数强制合并明显不同颜色。');
    if(els.limitPalette.checked)add('good','本次匹配启用了项目限定色板，共 '+parseProjectPaletteCodes().size+' 个候选色号。');
  }

  // ---------- Image / grid ----------
  function currentCrop(){
    return {
      l:clamp(Number(els.cropL.value)||0,0,45)/100,
      t:clamp(Number(els.cropT.value)||0,0,45)/100,
      r:clamp(Number(els.cropR.value)||0,0,45)/100,
      b:clamp(Number(els.cropB.value)||0,0,45)/100
    };
  }
  function prepareWorkCanvas(){
    if(!imageBitmap) return false;
    const cols=clamp(parseInt(els.cols.value)||38,1,300),rows=clamp(parseInt(els.rows.value)||38,1,300);
    const desired=Math.max(cols,rows)*12;
    const maxDim=Math.min(1800,Math.max(1000,desired));
    let baseCanvas=null;
    if(perspectiveEnabled){
      baseCanvas=perspectiveRectify(maxDim);
      if(!baseCanvas)return false;
    }else{
      const raw=rawSourceCanvas(maxDim);
      baseCanvas=raw.canvas;
    }
    const cr=currentCrop();
    const sx=baseCanvas.width*cr.l,sy=baseCanvas.height*cr.t;
    const sw=baseCanvas.width*(1-cr.l-cr.r),sh=baseCanvas.height*(1-cr.t-cr.b);
    if(sw<10||sh<10)return false;
    const scale=Math.min(1,maxDim/Math.max(sw,sh));
    workCanvas.width=Math.max(1,Math.round(sw*scale));
    workCanvas.height=Math.max(1,Math.round(sh*scale));
    workCtx.clearRect(0,0,workCanvas.width,workCanvas.height);
    workCtx.imageSmoothingEnabled=false;
    workCtx.drawImage(baseCanvas,sx,sy,sw,sh,0,0,workCanvas.width,workCanvas.height);
    return true;
  }

  els.file.addEventListener('change',async()=>{
    const file=els.file.files?.[0]; if(!file) return;
    try{
      imageBitmap?.close?.();
      imageBitmap=await createImageBitmap(file);
      cells=[];colorCatalog.clear();resultItems=[];blankKeys.clear();highlightKey=null;selectedCellIndex=-1;
      prepareWorkCanvas();renderPreview(true);renderResults();
      els.canvasEmpty.classList.add('hidden');
      perspectiveEnabled=false;els.perspectiveMode.value='off';perspectiveCorners=[{x:.03,y:.03},{x:.97,y:.03},{x:.97,y:.97},{x:.03,y:.97}];
      phaseOffset={x:0,y:0,score:null};els.phaseStatus.textContent='相位：等待分析';
      setStatus(els.imageStatus,'已载入 '+imageBitmap.width+'×'+imageBitmap.height+' 图像。请先确认网格行列数；拍照图建议设置四角透视校正。');
    }catch(err){setStatus(els.imageStatus,'无法读取这张图片：'+err.message,'error');}
  });

  [els.cols,els.rows,els.cropL,els.cropT,els.cropR,els.cropB].forEach(el=>el.addEventListener('change',()=>{
    if(imageBitmap){prepareWorkCanvas();renderPreview(true);}
  }));
  $('previewGridBtn').addEventListener('click',()=>{if(prepareWorkCanvas())renderPreview(true);});

  function renderPreview(showGrid=true){
    if(!imageBitmap || !workCanvas.width){
      pctx.clearRect(0,0,preview.width,preview.height);return;
    }
    preview.width=workCanvas.width;preview.height=workCanvas.height;
    pctx.imageSmoothingEnabled=false;
    pctx.drawImage(workCanvas,0,0);
    const cols=clamp(parseInt(els.cols.value)||1,1,300),rows=clamp(parseInt(els.rows.value)||1,1,300);
    const cw=preview.width/cols,ch=preview.height/rows;

    if(cells.length){
      for(let i=0;i<cells.length;i++){
        const c=cells[i],x=c.col*cw,y=c.row*ch;
        if(isCellBlank(c)){
          pctx.fillStyle='rgba(255,255,255,.26)';pctx.fillRect(x,y,cw,ch);
        }else if(highlightKey && c.key!==highlightKey){
          pctx.fillStyle='rgba(20,18,24,.58)';pctx.fillRect(x,y,cw,ch);
        }else if(c.low){
          pctx.fillStyle='rgba(255,176,40,.13)';pctx.fillRect(x,y,cw,ch);
        }
      }
      if(selectedCellIndex>=0 && cells[selectedCellIndex]){
        const c=cells[selectedCellIndex];
        pctx.strokeStyle='#ff3459';pctx.lineWidth=Math.max(2,preview.width/450);
        pctx.strokeRect(c.col*cw+1,c.row*ch+1,cw-2,ch-2);
      }
    }

    if(showGrid){
      pctx.beginPath();
      pctx.strokeStyle='rgba(116,55,245,.45)';
      pctx.lineWidth=Math.max(.6,preview.width/1300);
      const px=(analysisMeta?.phaseX??phaseOffset.x??0)*cw,py=(analysisMeta?.phaseY??phaseOffset.y??0)*ch;
      for(let i=1;i<cols;i++){const x=i*cw+px;pctx.moveTo(x,0);pctx.lineTo(x,preview.height);}
      for(let i=1;i<rows;i++){const y=i*ch+py;pctx.moveTo(0,y);pctx.lineTo(preview.width,y);}
      pctx.stroke();
    }
  }

  function grayAt(data,w,x,y){
    const i=(y*w+x)*4;
    return .2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  }
  function projection(axis,img,w,h){
    const len=axis==='x'?w:h,out=new Array(len).fill(0),step=3;
    if(axis==='x'){
      for(let x=1;x<w;x++) for(let y=0;y<h;y+=step) out[x]+=Math.abs(grayAt(img,w,x,y)-grayAt(img,w,x-1,y));
    }else{
      for(let y=1;y<h;y++) for(let x=0;x<w;x+=step) out[y]+=Math.abs(grayAt(img,w,x,y)-grayAt(img,w,x,y-1));
    }
    return out;
  }
  function inferSpacing(proj){
    const vals=proj.slice(2,-2).slice().sort((a,b)=>a-b);
    if(vals.length<10) return null;
    const threshold=vals[Math.floor(vals.length*.88)];
    const raw=[];
    for(let i=2;i<proj.length-2;i++){
      if(proj[i]>=threshold && proj[i]>=proj[i-1] && proj[i]>=proj[i+1]) raw.push(i);
    }
    const peaks=[];
    for(const p of raw){
      if(!peaks.length||p-peaks[peaks.length-1]>2) peaks.push(p);
      else if(proj[p]>proj[peaks[peaks.length-1]]) peaks[peaks.length-1]=p;
    }
    const diffs=[];
    for(let i=1;i<peaks.length;i++){const d=peaks[i]-peaks[i-1];if(d>=4&&d<=180)diffs.push(d);}
    if(diffs.length<3) return null;
    const hist=new Map();
    for(const d of diffs){
      const k=Math.round(d);
      for(let z=k-1;z<=k+1;z++) hist.set(z,(hist.get(z)||0)+1);
    }
    let best=null,bestN=0;
    hist.forEach((n,k)=>{if(n>bestN){bestN=n;best=k;}});
    if(!best||bestN<3) return null;
    return {spacing:best,confidence:bestN/diffs.length,peaks:peaks.length};
  }
  $('autoGridBtn').addEventListener('click',()=>{
    if(!prepareWorkCanvas()){setStatus(els.imageStatus,'请先上传图纸。','error');return;}
    const img=workCtx.getImageData(0,0,workCanvas.width,workCanvas.height).data;
    const vx=inferSpacing(projection('x',img,workCanvas.width,workCanvas.height));
    const vy=inferSpacing(projection('y',img,workCanvas.width,workCanvas.height));
    if(!vx||!vy){
      setStatus(els.imageStatus,'自动估算没有找到稳定的周期网格。请手动填写列数和行数；手动校准通常更可靠。','error');return;
    }
    const cols=clamp(Math.round(workCanvas.width/vx.spacing),1,300);
    const rows=clamp(Math.round(workCanvas.height/vy.spacing),1,300);
    els.cols.value=cols;els.rows.value=rows;renderPreview(true);
    const conf=Math.round(((vx.confidence+vy.confidence)/2)*100);
    setStatus(els.imageStatus,'自动估算：'+cols+' 列 × '+rows+' 行（周期一致性约 '+conf+'%）。请务必肉眼确认网格线对齐后再分析。');
  });

  function sampleCell(data,w,h,x0,y0,x1,y1,ratio){
    const cx=(x0+x1)/2,cy=(y0+y1)/2;
    const sw=(x1-x0)*ratio,sh=(y1-y0)*ratio;
    const left=clamp(Math.floor(cx-sw/2),0,w-1),right=clamp(Math.ceil(cx+sw/2),0,w-1);
    const top=clamp(Math.floor(cy-sh/2),0,h-1),bottom=clamp(Math.ceil(cy+sh/2),0,h-1);
    const nx=Math.min(9,Math.max(3,right-left+1)),ny=Math.min(9,Math.max(3,bottom-top+1));
    const samples=[],rs=[],gs=[],bs=[],as=[],lumas=[];
    for(let iy=0;iy<ny;iy++){
      const y=Math.round(top+(bottom-top)*(ny===1?0:iy/(ny-1)));
      for(let ix=0;ix<nx;ix++){
        const x=Math.round(left+(right-left)*(nx===1?0:ix/(nx-1)));
        const p=(y*w+x)*4,r=data[p],g=data[p+1],b=data[p+2],a=data[p+3],l=.2126*r+.7152*g+.0722*b;
        const s={rgb:[r,g,b],a,l};samples.push(s);
        rs.push(r);gs.push(g);bs.push(b);as.push(a);lumas.push(l);
      }
    }
    const target=[median(rs),median(gs),median(bs)];
    let rep=samples[0],best=Infinity;
    for(const s of samples){
      const d=(s.rgb[0]-target[0])**2+(s.rgb[1]-target[1])**2+(s.rgb[2]-target[2])**2;
      if(d<best){best=d;rep=s;}
    }
    const lm=lumas.reduce((s,v)=>s+v,0)/lumas.length;
    const variance=lumas.reduce((s,v)=>s+(v-lm)*(v-lm),0)/lumas.length;
    return {rgb:rep.rgb,hex:rgbToHex(...rep.rgb),lab:rgbToLab(rep.rgb),alpha:median(as),std:Math.sqrt(variance)};
  }

  async function analyze(){
    if(!imageBitmap){setStatus(els.imageStatus,'请先上传图纸。','error');return;}
    if(!prepareWorkCanvas()){setStatus(els.imageStatus,'当前裁切或四角校正范围无效。','error');return;}
    const cols=clamp(parseInt(els.cols.value)||0,1,300),rows=clamp(parseInt(els.rows.value)||0,1,300);
    const total=cols*rows;
    if(total>60000){setStatus(els.imageStatus,'当前网格超过 60,000 格。请确认行列数是否填写正确。','error');return;}
    const ratio=Number(els.ratio.value)||.55,mode=els.mode.value;
    if(els.limitPalette.checked && !parseProjectPaletteCodes().size && (mode==='mard221'||mode==='mard291')){
      setStatus(els.imageStatus,'已启用项目限定色板，但还没有填写任何 MARD 色号。','error');return;
    }
    let palette=[];
    if(mode==='palette'){
      palette=parsePalette();
      if(!palette.length){setStatus(els.imageStatus,'自定义色卡模式下没有有效色卡。格式：色号,#RRGGBB,名称。','error');return;}
    }else if(mode==='mard221'||mode==='mard291'){
      palette=getMardPalette(mode);
      if(!palette.length){setStatus(els.imageStatus,'MARD 候选色卡为空，请检查项目限定色板。','error');return;}
    }

    els.analyze.disabled=true;els.analyze.textContent='分析中…';
    await new Promise(r=>requestAnimationFrame(r));
    try{
      const img=workCtx.getImageData(0,0,workCanvas.width,workCanvas.height).data;
      const cw=workCanvas.width/cols,ch=workCanvas.height/rows;
      phaseOffset=findGridPhase(img,workCanvas.width,workCanvas.height,cols,rows);
      els.phaseStatus.textContent=phaseOffset.score==null?'相位：固定居中':'相位：X '+phaseOffset.x.toFixed(2)+' / Y '+phaseOffset.y.toFixed(2);
      const raw=[];
      for(let row=0;row<rows;row++){
        for(let col=0;col<cols;col++){
          const dx=phaseOffset.x*cw,dy=phaseOffset.y*ch;
          const s=sampleCell(img,workCanvas.width,workCanvas.height,col*cw+dx,row*ch+dy,(col+1)*cw+dx,(row+1)*ch+dy,ratio);
          raw.push({row,col,...s,key:null,delta:null,low:false,ambiguous:false,candidates:null,autoBlank:false});
        }
      }

      colorCatalog=new Map();
      const sourceTol=clamp(Number(els.sourceMerge.value)||2.4,.5,8);
      const rawColorCount=new Set(raw.filter(x=>x.alpha>=40).map(x=>x.hex)).size;
      let sourceClusters=clusterSourceCells(raw,sourceTol);
      sourceClusters=spatialRefineClusters(raw,sourceClusters,cols,rows,sourceTol);
      sourceClusters=constrainClusterCount(raw,sourceClusters,Number(els.expectedColors.value)||0);
      for(const cell of raw){if(cell.alpha<40){cell.key='__transparent__';cell.low=false;cell.delta=0;cell.autoBlank=true;}}

      if(mode!=='cluster'){
        const threshold=clamp(Number(els.delta.value)||8,1,30);
        let unknownSeq=0;
        for(const cl of sourceClusters){
          const ranked=rankPalette(cl.lab,palette,3),best=ranked[0],second=ranked[1];
          const bestD=best?.delta??Infinity;
          const rejected=!best||bestD>threshold;
          const ambiguous=!rejected && !!second && (second.delta-bestD<1.2) && bestD>1.0;
          let key;
          if(rejected){
            key='__unknown_'+(++unknownSeq);
            colorCatalog.set(key,{key,code:'未知'+String(unknownSeq).padStart(2,'0'),name:'未匹配色',hex:cl.hex,rgb:cl.rgb,lab:cl.lab,unknown:true,candidateRanks:ranked});
          }else{
            key=best.key;
            const old=colorCatalog.get(key);
            if(!old||!old._clusterCount||cl.count>old._clusterCount) colorCatalog.set(key,{...palette.find(p=>p.key===key),candidateRanks:ranked,_clusterCount:cl.count});
          }
          const uncertain=rejected||ambiguous||!!best?.special;
          for(const cell of cl.cells){
            cell.key=key;cell.delta=bestD;cell.low=uncertain||cell.std>24;cell.ambiguous=ambiguous;cell.candidates=ranked;
          }
        }
        for(const p of palette) if(!colorCatalog.has(p.key)) colorCatalog.set(p.key,{...p});
      }else{
        sourceClusters.sort((a,b)=>b.count-a.count);
        sourceClusters.forEach((cl,i)=>{
          const code='C'+String(i+1).padStart(2,'0');
          colorCatalog.set(code,{key:code,code,name:'自动颜色 '+String(i+1).padStart(2,'0'),hex:cl.hex,rgb:cl.rgb,lab:cl.lab});
          for(const cell of cl.cells){cell.key=code;cell.delta=0;cell.low=cell.std>24;}
        });
      }

      colorCatalog.set('__transparent__',{key:'__transparent__',code:'透明',name:'透明 / 空白',hex:'#FFFFFF',rgb:[255,255,255],lab:rgbToLab([255,255,255])});
      cells=raw;
      blankKeys=new Set(['__transparent__']);
      const bgTol=clamp(Number(els.backgroundTol.value)||4,1,12);
      const bgResult=els.autoBlank.checked?detectConnectedBackground(cells,cols,rows,bgTol):{count:0,seed:null};

      const paletteName=mode==='mard221'?'MARD 221 (2026)':mode==='mard291'?'MARD 291 (2026)':mode==='palette'?(els.paletteName.value.trim()||'我的色卡'):'自动聚类';
      const pitch=clamp(Number(els.beadPitch.value)||2.6,2,4);
      analysisMeta={
        cols,rows,mode,ratio,crop:currentCrop(),paletteName,tolerance:Number(els.tolerance.value)||5,
        sourceMergeTolerance:sourceTol,sourceRawColorCount:rawColorCount,sourceColorCount:sourceClusters.length,
        deltaThreshold:Number(els.delta.value)||8,beadPitchMm:pitch,physicalWidthCm:cols*pitch/10,physicalHeightCm:rows*pitch/10,
        phaseX:phaseOffset.x,phaseY:phaseOffset.y,phaseScore:phaseOffset.score,perspective:perspectiveEnabled,
        backgroundTolerance:bgTol,backgroundCount:bgResult.count,limitedPalette:els.limitPalette.checked?parseProjectPaletteCodes().size:0,
        expectedColors:Number(els.expectedColors.value)||0
      };

      aggregate();
      highlightKey=null;selectedCellIndex=-1;els.cellEditor.classList.add('hidden');
      renderPreview(true);renderResults();updateDiagnostics();
      setStatus(els.imageStatus,'V2 分析完成：已执行网格相位、源色空间合并、连通背景、Top-3 MARD 候选与拒识判断。请检查“精度诊断”。');
    }catch(err){
      console.error(err);setStatus(els.imageStatus,'分析失败：'+err.message,'error');
    }finally{
      els.analyze.disabled=false;els.analyze.textContent='开始精确分析';
    }
  }
  els.analyze.addEventListener('click',analyze);

  function aggregate(){
    const map=new Map();
    for(const c of cells){
      if(isCellBlank(c))continue;
      const meta=colorCatalog.get(c.key)||{key:c.key,code:c.key,name:c.key,hex:c.hex||'#999999'};
      if(!map.has(c.key)) map.set(c.key,{...meta,qty:0,low:0,ambiguous:0,deltaSum:0,deltaN:0,candidateRanks:meta.candidateRanks||c.candidates||null});
      const x=map.get(c.key);x.qty++;if(c.low)x.low++;if(c.ambiguous)x.ambiguous++;
      if(Number.isFinite(c.delta)){x.deltaSum+=c.delta;x.deltaN++;}
      if(!x.candidateRanks&&c.candidates)x.candidateRanks=c.candidates;
    }
    resultItems=[...map.values()].map(x=>({...x,avgDelta:x.deltaN?x.deltaSum/x.deltaN:null,isBlank:false}))
      .sort((a,b)=>b.qty-a.qty);
  }

  function renderResults(){
    aggregateIfPossible();
    els.resultBody.textContent='';
    if(!resultItems.length){
      const tr=create('tr');const td=create('td','empty-row','暂无豆子颜色结果');td.colSpan=7;tr.append(td);els.resultBody.append(tr);
      updateAudit();updateDiagnostics();return;
    }
    const paletteName=analysisMeta?.paletteName||'自动聚类';
    for(const item of resultItems){
      const tr=create('tr'); if(item.key===highlightKey) tr.style.background='#f5f1ff';
      const c1=create('td');const sw=create('span','swatch');sw.style.background=item.hex;c1.append(sw,document.createTextNode(item.name||item.code));
      if(item.unknown)c1.append(create('span','unknown-tag','未知')); else if(item.ambiguous)c1.append(create('span','ambiguous-tag','歧义'));
      tr.append(c1);
      const c2=create('td');const codeBtn=btn(item.code,'code-btn');codeBtn.addEventListener('click',()=>{highlightKey=item.key;renderPreview(true);renderResults();});c2.append(codeBtn);tr.append(c2);
      tr.append(create('td','',item.qty.toLocaleString()));
      const confTd=create('td',item.low?'low':'');
      const main=item.low?('待确认 '+item.low):(item.avgDelta!=null?('ΔE '+item.avgDelta.toFixed(1)):'稳定');
      confTd.append(document.createTextNode(main));
      if(item.candidateRanks?.length){
        const txt=item.candidateRanks.map((x,i)=>(i+1)+'. '+x.code+' '+x.delta.toFixed(1)).join(' · ');
        confTd.append(create('span','candidate-line',txt));
      }
      tr.append(confTd);
      let inv=inventoryMap.get(escKey(paletteName,item.code))?.quantity||0;
      const missing=Math.max(0,item.qty-inv);
      tr.append(create('td','',inv.toLocaleString()));
      tr.append(create('td',missing?'missing':'enough',missing?missing.toLocaleString():'足够'));
      const act=create('td');const wrap=create('div','row-actions');
      const hb=btn('高亮');hb.addEventListener('click',()=>{highlightKey=item.key;renderPreview(true);renderResults();});
      const bb=btn('整色设空白');bb.addEventListener('click',()=>{els.autoBlank.checked=false;if(blankKeys.has(item.key))blankKeys.delete(item.key);else blankKeys.add(item.key);aggregate();renderPreview(true);renderResults();updateDiagnostics();});
      const ib=btn('填入库存');ib.addEventListener('click',()=>prefillInventory(item));
      wrap.append(hb,bb,ib);act.append(wrap);tr.append(act);
      els.resultBody.append(tr);
    }
    updateAudit();updateDiagnostics();
  }
  function aggregateIfPossible(){if(cells.length)aggregate();}
  function updateAudit(){
    const total=cells.length||0;
    const blanks=cells.reduce((n,c)=>n+(isCellBlank(c)?1:0),0);
    const beads=total-blanks,low=cells.reduce((n,c)=>n+(c.low&&!isCellBlank(c)?1:0),0);
    els.auditCells.textContent=total.toLocaleString();els.auditBeads.textContent=beads.toLocaleString();els.auditBlank.textContent=blanks.toLocaleString();els.auditLow.textContent=low.toLocaleString();
    if(!total){els.integrity.textContent='数学自检：等待分析';els.quality.textContent='等待分析';els.quality.className='quality-badge';return;}
    const expected=(analysisMeta?.cols||0)*(analysisMeta?.rows||0),ok=total===expected && beads+blanks===expected;
    els.integrity.textContent='数学自检：'+(ok?'通过':'异常')+' · '+beads+' 豆子 + '+blanks+' 空白 = '+expected+' 格';
    const rate=beads?low/beads:0;
    els.quality.className='quality-badge '+(rate<=.01?'good':rate<=.05?'warn':'bad');
    els.quality.textContent=rate<=.01?'识别质量高':rate<=.05?'建议复核':'需要校准';
    const mappedColors=resultItems.length;
    const modeNote=analysisMeta?.mode==='cluster'
      ? ' 自动色号仅在本次图纸内稳定。'
      : analysisMeta?.mode==='mard291'
        ? ' 特殊材质系列会额外标记为待确认。'
        : '';
    const sourceInfo=analysisMeta?.sourceColorCount!=null?' 源色聚类 '+analysisMeta.sourceColorCount+' 种 → 最终 '+mappedColors+' 种。':'';
    const sizeInfo=analysisMeta?.beadPitchMm?' 约 '+analysisMeta.physicalWidthCm.toFixed(2)+'×'+analysisMeta.physicalHeightCm.toFixed(2)+' cm。':'';
    els.resultSub.textContent='待确认 '+low+' 格。'+sourceInfo+sizeInfo+modeNote;
  }

  els.autoBlank.addEventListener('change',()=>{
    if(!cells.length)return;
    blankKeys=new Set(['__transparent__']);cells.forEach(c=>{c.autoBlank=c.key==='__transparent__';});
    if(els.autoBlank.checked&&analysisMeta){
      const bg=detectConnectedBackground(cells,analysisMeta.cols,analysisMeta.rows,analysisMeta.backgroundTolerance||4);
      analysisMeta.backgroundCount=bg.count;
    }else if(analysisMeta) analysisMeta.backgroundCount=0;
    aggregate();renderPreview(true);renderResults();updateDiagnostics();
  });
  $('clearHighlightBtn').addEventListener('click',()=>{highlightKey=null;renderPreview(true);renderResults();});

  // ---------- Built-in synthetic regression benchmark ----------
  function benchmarkPalette(){
    const src=(globalThis.MARDPalette?.colors||[]).filter(x=>x.standard);
    return src.map(x=>{const rgb=hexToRgb(x.hex);return {key:x.code,code:x.code,name:'MARD '+x.code,hex:x.hex,rgb,lab:rgbToLab(rgb)};});
  }
  function seededRandom(seed){
    let s=seed>>>0;
    return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  }
  function runBenchmarkCase(noise=0,seed=1){
    const palette=benchmarkPalette(),byCode=new Map(palette.map(x=>[x.code,x]));
    const codes=['A4','A7','B5','B20','C8','C10','D5','E6','F5','G7','H2','H7'];
    const valid=codes.map(x=>byCode.get(x)).filter(Boolean);
    if(valid.length<8)return null;
    const cols=24,rows=18,rng=seededRandom(seed),raw=[];
    for(let row=0;row<rows;row++){
      for(let col=0;col<cols;col++){
        const p=valid[(Math.floor(col/4)+Math.floor(row/3)*3)%valid.length];
        const rgb=p.rgb.map(v=>clamp(Math.round(v+(rng()-.5)*2*noise),0,255));
        raw.push({row,col,rgb,hex:rgbToHex(...rgb),lab:rgbToLab(rgb),alpha:255,std:noise*.35,key:null,expected:p.code});
      }
    }
    let clusters=clusterSourceCells(raw,2.4);
    clusters=spatialRefineClusters(raw,clusters,cols,rows,2.4);
    for(const cl of clusters){
      const best=rankPalette(cl.lab,palette,1)[0];
      for(const cell of cl.cells)cell.predicted=best?.code||'';
    }
    const correct=raw.filter(x=>x.predicted===x.expected).length;
    const predictedColors=new Set(raw.map(x=>x.predicted)).size;
    const expectedColors=new Set(raw.map(x=>x.expected)).size;
    return {accuracy:correct/raw.length,cells:raw.length,predictedColors,expectedColors,raw,cols,rows};
  }
  function renderBenchmarkPattern(result){
    const old=benchmarkBox.querySelector?.('.benchmark-canvas'); if(old)old.remove();
    if(!result)return;
    const cv=document.createElement('canvas');cv.className='benchmark-canvas';cv.width=240;cv.height=180;
    const ctx=cv.getContext('2d'),cw=cv.width/result.cols,ch=cv.height/result.rows;
    for(const cell of result.raw){ctx.fillStyle=cell.hex;ctx.fillRect(cell.col*cw,cell.row*ch,Math.ceil(cw),Math.ceil(ch));}
    els.benchmarkResult.parentElement.append(cv);
  }
  els.runBenchmark.addEventListener('click',()=>{
    const cases=[
      {name:'标准图',r:runBenchmarkCase(0,11)},
      {name:'轻度压缩噪声',r:runBenchmarkCase(3,22)},
      {name:'较强颜色扰动',r:runBenchmarkCase(6,33)}
    ].filter(x=>x.r);
    if(!cases.length){els.benchmarkResult.textContent='色卡未加载，无法运行';return;}
    const mean=cases.reduce((s,x)=>s+x.r.accuracy,0)/cases.length;
    benchmarkState={mean,cases};
    els.benchmarkResult.textContent=cases.map(x=>x.name+' '+(x.r.accuracy*100).toFixed(1)+'%').join(' · ')+' · 平均 '+(mean*100).toFixed(1)+'%';
    renderBenchmarkPattern(cases[1]?.r||cases[0].r);
  });

  preview.addEventListener('click',e=>{
    if(!cells.length||!analysisMeta)return;
    const rect=preview.getBoundingClientRect();
    const x=(e.clientX-rect.left)/rect.width*preview.width,y=(e.clientY-rect.top)/rect.height*preview.height;
    const col=clamp(Math.floor(x/(preview.width/analysisMeta.cols)),0,analysisMeta.cols-1);
    const row=clamp(Math.floor(y/(preview.height/analysisMeta.rows)),0,analysisMeta.rows-1);
    selectedCellIndex=row*analysisMeta.cols+col;
    const c=cells[selectedCellIndex];if(!c)return;
    els.cellLabel.textContent='第 '+(row+1)+' 行 · 第 '+(col+1)+' 列';
    els.cellConfidence.textContent='当前 '+(colorCatalog.get(c.key)?.code||c.key)+(c.delta!=null?' · ΔE '+c.delta.toFixed(2):'')+(c.low?' · 待确认':'');
    els.cellSelect.textContent='';
    for(const item of resultItems){
      const op=create('option');op.value=item.key;op.textContent=item.code+' · '+item.name;op.selected=item.key===c.key;els.cellSelect.append(op);
    }
    els.cellEditor.classList.remove('hidden');renderPreview(true);
  });
  $('applyCellBtn').addEventListener('click',()=>{
    const c=cells[selectedCellIndex];if(!c)return;
    c.key=els.cellSelect.value;c.low=false;c.delta=0;
    aggregate();renderPreview(true);renderResults();
    els.cellConfidence.textContent='已人工确认并修正';
  });

  // ---------- Inventory ----------
  async function loadInventory(){
    if(!session){inventoryRows=[];inventoryMap.clear();renderInventory();renderResults();return;}
    const scope=els.invScope.value;
    if(scope==='group'&&!group){setStatus(els.invStatus,'当前账号没有共享库存权限。','error');return;}
    try{
      const filter=scope==='group'
        ? 'group_id=eq.'+q(group.id)+'&owner_user_id=is.null'
        : 'owner_user_id=eq.'+q(session.user.id)+'&group_id=is.null';
      inventoryRows=await ToolboxAuth.rest('bead_inventory?select=id,palette_name,color_code,color_name,color_hex,quantity,updated_at&'+filter+'&order=palette_name.asc,color_code.asc');
      inventoryMap=new Map(inventoryRows.map(r=>[escKey(r.palette_name,r.color_code),r]));
      renderInventory();renderResults();await loadEvents();
      setStatus(els.invStatus,'已同步 '+inventoryRows.length+' 个色号 · '+formatTime(new Date()));
    }catch(err){setStatus(els.invStatus,'库存同步失败：'+err.message,'error');}
  }
  els.invScope.addEventListener('change',loadInventory);
  $('refreshInventoryBtn').addEventListener('click',loadInventory);

  function renderInventory(){
    els.invBody.textContent='';
    if(!session){const tr=create('tr');const td=create('td','empty-row','登录后加载库存');td.colSpan=6;tr.append(td);els.invBody.append(tr);return;}
    if(!inventoryRows.length){const tr=create('tr');const td=create('td','empty-row','当前库存为空，可在上方添加');td.colSpan=6;tr.append(td);els.invBody.append(tr);return;}
    for(const r of inventoryRows){
      const tr=create('tr');
      const c1=create('td');const sw=create('span','swatch');sw.style.background=r.color_hex;c1.append(sw);tr.append(c1);
      tr.append(create('td','',r.palette_name),create('td','',r.color_code),create('td','',r.color_name||'—'),create('td','',Number(r.quantity).toLocaleString()));
      const a=create('td');const e=btn('编辑');e.addEventListener('click',()=>{els.invPalette.value=r.palette_name;els.invCode.value=r.color_code;els.invName.value=r.color_name||'';els.invHex.value=r.color_hex;els.invQty.value=r.quantity;window.scrollTo({top:0,behavior:'smooth'});});a.append(e);tr.append(a);
      els.invBody.append(tr);
    }
  }

  $('inventoryForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!session){setStatus(els.invStatus,'请先登录。','error');return;}
    const scope=els.invScope.value;if(scope==='group'&&!group){setStatus(els.invStatus,'没有共享组权限。','error');return;}
    const payload={
      p_scope:scope,p_group_id:scope==='group'?group.id:null,
      p_palette_name:els.invPalette.value.trim(),p_color_code:els.invCode.value.trim().toUpperCase(),
      p_color_name:els.invName.value.trim(),p_color_hex:els.invHex.value.toUpperCase(),
      p_quantity:Math.max(0,parseInt(els.invQty.value)||0),p_reason:'manual'
    };
    if(!payload.p_palette_name||!payload.p_color_code){setStatus(els.invStatus,'请填写色卡和色号。','error');return;}
    const {error}=await db.rpc('bead_set_inventory',payload);
    if(error){setStatus(els.invStatus,'保存失败：'+error.message,'error');return;}
    await loadInventory();setStatus(els.invStatus,'库存已保存并同步。');
  });

  function prefillInventory(item){
    if(!analysisMeta)return;
    els.invPalette.value=analysisMeta.paletteName;els.invCode.value=item.code;els.invName.value=item.name||'';els.invHex.value=item.hex;els.invQty.value=inventoryMap.get(escKey(analysisMeta.paletteName,item.code))?.quantity||0;
    switchTab('inventory');
  }

  async function loadEvents(){
    if(!session){els.eventList.innerHTML='<div class="empty-note">暂无记录</div>';return;}
    try{
      const scope=els.invScope.value;
      const filter=scope==='group'&&group?'group_id=eq.'+q(group.id):'owner_user_id=eq.'+q(session.user.id);
      const rows=await ToolboxAuth.rest('bead_inventory_events?select=id,palette_name,color_code,delta,resulting_quantity,reason,created_at&'+filter+'&order=created_at.desc&limit=12');
      els.eventList.textContent='';
      if(!rows.length){els.eventList.append(create('div','empty-note','暂无记录'));return;}
      for(const r of rows){
        const line=create('div','event');const left=create('div');left.append(create('strong','',r.palette_name+' · '+r.color_code),create('span','', ' · '+formatTime(r.created_at)+' · '+r.reason));
        const d=create('b',r.delta>=0?'plus':'minus',(r.delta>=0?'+':'')+r.delta+' → '+r.resulting_quantity);line.append(left,d);els.eventList.append(line);
      }
    }catch(err){console.warn(err);}
  }

  // ---------- Projects ----------
  $('saveProjectBtn').addEventListener('click',async()=>{
    if(!session){setStatus(els.projectStatus,'请先登录后再保存云端项目。','error');return;}
    if(!cells.length||!analysisMeta){setStatus(els.projectStatus,'请先完成图纸分析。','error');return;}
    const title=els.projectTitle.value.trim();if(!title){setStatus(els.projectStatus,'请填写项目名称。','error');return;}
    const scope=els.projectScope.value;if(scope==='group'&&!group){setStatus(els.projectStatus,'当前账号没有共享项目权限。','error');return;}
    aggregate();
    const items=resultItems.filter(x=>!blankKeys.has(x.key)).map(x=>({code:x.code,name:x.name,hex:x.hex,quantity:x.qty,low_confidence:x.low,avg_delta:x.avgDelta==null?null:Number(x.avgDelta.toFixed(3))}));
    const blank=cells.reduce((n,c)=>n+(blankKeys.has(c.key)?1:0),0),low=cells.reduce((n,c)=>n+(c.low&&!blankKeys.has(c.key)?1:0),0);
    const body={
      owner_user_id:session.user.id,group_id:scope==='group'?group.id:null,title,
      palette_name:analysisMeta.paletteName,source_mode:'grid',grid_width:analysisMeta.cols,grid_height:analysisMeta.rows,
      total_cells:cells.length,blank_cells:blank,total_beads:cells.length-blank,low_confidence_cells:low,items,
      analysis_settings:{sample_ratio:analysisMeta.ratio,crop:analysisMeta.crop,match_mode:analysisMeta.mode,cluster_tolerance:analysisMeta.tolerance,source_merge_tolerance:analysisMeta.sourceMergeTolerance,source_color_count:analysisMeta.sourceColorCount,delta_threshold:analysisMeta.deltaThreshold,bead_pitch_mm:analysisMeta.beadPitchMm,physical_width_cm:analysisMeta.physicalWidthCm,physical_height_cm:analysisMeta.physicalHeightCm}
    };
    try{
      await ToolboxAuth.rest('bead_projects',{method:'POST',body,prefer:'return=minimal'});
      setStatus(els.projectStatus,'项目已保存到云端。');loadProjects();
    }catch(err){setStatus(els.projectStatus,'保存项目失败：'+err.message,'error');}
  });

  async function loadProjects(){
    if(!session){els.projectList.textContent='';els.projectList.append(create('div','empty-note','登录后可查看项目'));return;}
    try{
      const rows=await ToolboxAuth.rest('bead_projects?select=id,title,group_id,palette_name,grid_width,grid_height,total_beads,blank_cells,low_confidence_cells,created_at,items&order=created_at.desc&limit=30');
      els.projectList.textContent='';
      if(!rows.length){els.projectList.append(create('div','empty-note','暂无云端项目'));return;}
      for(const r of rows){
        const card=create('article','project-item');card.append(create('h3','',r.title));
        card.append(create('p','',r.grid_width+'×'+r.grid_height+' · '+r.total_beads.toLocaleString()+' 颗 · '+r.palette_name+' · '+formatTime(r.created_at)));
        const tags=create('div','project-tags');tags.append(create('span','',r.group_id?'共享':'个人'),create('span','',(Array.isArray(r.items)?r.items.length:0)+' 色'),create('span','',r.low_confidence_cells+' 待确认'));
        card.append(tags);els.projectList.append(card);
      }
    }catch(err){els.projectList.textContent='';els.projectList.append(create('div','empty-note','项目加载失败：'+err.message));}
  }
  $('refreshProjectsBtn').addEventListener('click',loadProjects);

  // Periodic shared-state refresh without third-party realtime dependency.
  function startPolling(){
    clearInterval(inventoryPoll);
    inventoryPoll=setInterval(()=>{
      if(session && !document.hidden && document.querySelector('.tab[data-tab="inventory"]').classList.contains('active')) loadInventory();
    },8000);
  }

  // ---------- init ----------
  loadPaletteLocal();
  initMardPalette();
  updateProjectPaletteStatus();
  updatePhysicalInfo();
  refreshAuthUI().finally(startPolling);
  window.addEventListener('pagehide',()=>clearInterval(inventoryPoll),{once:true});
})();