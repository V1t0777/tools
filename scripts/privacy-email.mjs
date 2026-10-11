// Scan source literals in linear time. Avoid nested-quantifier email regexes on attacker-sized SQL/catalog files.
const isAlpha=c=>(c>=65&&c<=90)||(c>=97&&c<=122);
const isDigit=c=>c>=48&&c<=57;
const isWord=c=>isAlpha(c)||isDigit(c)||c===95;
const isLocal=c=>isWord(c)||c===46||c===37||c===43||c===45;
const isDomain=c=>isAlpha(c)||isDigit(c)||c===46||c===45;

export function findEmailLiterals(content){
  const emails=[];
  for(let at=content.indexOf('@');at!==-1;at=content.indexOf('@',at+1)){
    let start=at;
    while(start>0&&isLocal(content.charCodeAt(start-1)))start--;
    if(start===at||(start>0&&isWord(content.charCodeAt(start-1))))continue;
    let end=at+1;
    while(end<content.length&&isDomain(content.charCodeAt(end)))end++;
    if(end===at+1)continue;
    // The historical regex ends with a word boundary; trailing dots/hyphens are not email domain content.
    while(end>at+1&&!isWord(content.charCodeAt(end-1)))end--;
    const domain=content.slice(at+1,end);
    const dot=domain.lastIndexOf('.');
    if(dot<1||dot===domain.length-1)continue;
    let valid=true;
    for(let i=dot+1;i<domain.length;i++)if(!isAlpha(domain.charCodeAt(i)))valid=false;
    if(!valid||domain.length-dot-1<2)continue;
    emails.push(content.slice(start,end));
  }
  return emails;
}
