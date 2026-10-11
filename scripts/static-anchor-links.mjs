// Limited, deterministic reader for repository-owned static navigation fixtures.
// This is not a sanitizer and never processes untrusted HTML in a browser.
const space=c=>c===' '||c==='\n'||c==='\t'||c==='\r'||c==='\f';

function tagEnd(html,start){
  let quote='';
  for(let i=start+1;i<html.length;i++){
    const c=html[i];
    if(quote){if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='>')return i;
  }
  throw new Error('Unclosed HTML tag in static navigation fixture');
}
function attribute(tag,name){
  let i=0;
  while(i<tag.length){
    while(i<tag.length&&space(tag[i]))i++;
    const begin=i;
    while(i<tag.length&&!space(tag[i])&&tag[i]!=='='&&tag[i]!=='/'&&tag[i]!=='>')i++;
    if(begin===i){i++;continue;}
    const key=tag.slice(begin,i).toLowerCase();
    while(i<tag.length&&space(tag[i]))i++;
    if(tag[i]!=='=')continue;
    i++;
    while(i<tag.length&&space(tag[i]))i++;
    let value='';
    if(tag[i]==='"'||tag[i]==="'"){
      const quote=tag[i++];
      const valueStart=i;
      while(i<tag.length&&tag[i]!==quote)i++;
      if(i>=tag.length)throw new Error('Unclosed HTML attribute');
      value=tag.slice(valueStart,i++);
    }else{
      const valueStart=i;
      while(i<tag.length&&!space(tag[i])&&tag[i]!=='>')i++;
      value=tag.slice(valueStart,i);
    }
    if(key===name)return value;
  }
  return null;
}
function visibleText(body){
  let result='';
  for(let i=0;i<body.length;){
    if(body[i]==='<'){
      i=tagEnd(body,i)+1;
    }else{
      result+=body[i++];
    }
  }
  return result;
}
export function returnLinks(html){
  const hrefs=[];
  let cursor=0;
  while(cursor<html.length){
    const start=html.indexOf('<a',cursor);
    if(start<0)break;
    const boundary=html[start+2];
    if(boundary!==undefined&&!space(boundary)&&boundary!=='>'){cursor=start+2;continue;}
    const end=tagEnd(html,start);
    const close=html.indexOf('</a>',end+1);
    if(close<0)throw new Error('Unclosed anchor in static navigation fixture');
    const href=attribute(html.slice(start+2,end),'href');
    const label=visibleText(html.slice(end+1,close)).trim();
    if(href&&(label.startsWith('←')||label.startsWith('返回')))hrefs.push(href);
    cursor=close+4;
  }
  return hrefs;
}
