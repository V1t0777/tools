/**
 * Fail-closed HTML asset validator for the three public Yunyu entrypoints.
 * Read exact tag boundaries and attribute forms, not case-sensitive HTML
 * filtering expressions. Mixed-case <SCRIPT> is always processed.
 */
const scripts={"merge/index.html":1,"merge/story.html":1,"merge/story-workshop.html":2};
const styles={"merge/index.html":2,"merge/story.html":2,"merge/story-workshop.html":3};
function tags(html,tag){
  const lower=html.toLowerCase(),list=[];
  let cursor=0;
  while(true){
    const i=lower.indexOf('<'+tag,cursor);
    if(i<0)return list;
    const boundary=lower[i+tag.length+1];
    if(boundary!==undefined&&!/\s|>|\//.test(boundary)){cursor=i+tag.length+1;continue}
    const end=html.indexOf('>',i+tag.length+1);
    if(end<0)throw Error('Malformed <'+tag+'> tag');
    list.push({start:i,end:end+1,open:html.slice(i,end+1)});
    cursor=end+1;
  }
}
export function auditOfflineHtml(html,path,allowResource){
  if(!Object.hasOwn(scripts,path)||typeof allowResource!=='function')
    throw Error('Unreviewed offline HTML: '+path);
  const found=tags(html,'script');
  if(found.length!==scripts[path])throw Error('Script count changed: '+path);
  for(const tag of found){
    const valid=/^<script\s+type="module"\s+src="(\.[^"]+\.mjs)"\s*>$/i.exec(tag.open);
    if(!valid)throw Error('Unreviewed script tag: '+path);
    const close=html.toLowerCase().indexOf('</script>',tag.end);
    if(close<0||html.slice(tag.end,close).trim())
      throw Error('Inline or unclosed script: '+path);
    allowResource(path,valid[1]);
  }
  const sheets=tags(html,'link');
  if(sheets.length!==styles[path])throw Error('Stylesheet count changed: '+path);
  for(const tag of sheets){
    const valid=/^<link\s+rel="stylesheet"\s+href="(\.[^"]+\.css)"\s*>$/i.exec(tag.open);
    if(!valid)throw Error('Unreviewed stylesheet tag: '+path);
    allowResource(path,valid[1]);
  }
}
