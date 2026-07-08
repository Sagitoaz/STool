/* ─── Constants ─────────────────────────────────────────────────────────────── */
const API_BASE = (window.location.port === '3000' || window.location.port === '')
  ? ''
  : 'http://localhost:3000';

/* ─── Bookmarklet Code ───────────────────────────────────────────────────────── */
// Strategy: window.open (user-triggered = no popup block) + postMessage (no CORS)
// The import.html page on localhost receives the message and calls /api/extract (same-origin)
// This completely avoids Chrome's mixed-content / Private-Network-Access restrictions.
const BOOKMARKLET_CODE_OLD = `(async function(){
const S='http://localhost:3000';
// 1. Open import page IMMEDIATELY (before any async ops) → not blocked as popup
const iw=window.open(S+'/import.html','stool_import');
// 2. Show toast
const t=document.createElement('div');
t.style='position:fixed;top:16px;right:16px;background:linear-gradient(135deg,#6366f1,#06b6d4);color:#fff;padding:12px 18px;border-radius:12px;z-index:2147483647;font:500 14px system-ui;box-shadow:0 8px 32px rgba(0,0,0,.4);line-height:1.5;max-width:300px;';
t.innerHTML='<b>\\u{1F4C4} STool</b><br>\\u0110ang t\\u00ecm trang t\\u00e0i li\\u1ec7u...';
document.body.appendChild(t);
// 3. Extract URLs
let urls=[];
let pageCount=0;
const nd=document.getElementById('__NEXT_DATA__');
if(nd){try{
function pc(o,d){if(d>12||!o||typeof o!=='object')return 0;for(const k of Object.keys(o)){const n=Number(o[k]);if(/^(pageCount|pagesCount|numberOfPages|numPages|totalPages|total_pages)$/i.test(k)&&Number.isInteger(n)&&n>0&&n<=1000)return n;}for(const k of Object.keys(o)){const r=pc(o[k],d+1);if(r)return r;}return 0;}
function fi(o,d){if(d>20||!o||typeof o!=='object')return null;
if(Array.isArray(o)&&o.length>0){const f=o[0];
if(typeof f==='string'&&f.startsWith('http')&&(f.includes('cloudfront')||/\\.(jpg|png|webp)/i.test(f)))return o.filter(x=>typeof x==='string'&&x.startsWith('http'));
if(typeof f==='object'){for(const p of['image_url','imageUrl','url','src','thumbnail_url']){const u=o.map(x=>x&&x[p]).filter(v=>typeof v==='string'&&v.startsWith('http')&&(v.includes('cloudfront')||/\\.(jpg|png|webp)/i.test(v)));if(u.length>0)return u;}}
return null;}
for(const k of Object.keys(o)){const r=fi(o[k],d+1);if(r)return r;}return null;}
const data=JSON.parse(nd.textContent);pageCount=pc(data,0);const u=fi(data,0);if(u)urls=u;}catch(e){}}
if(!pageCount){const ms=[...(document.body.innerText||'').matchAll(/(\d{1,4})\s*(?:pages?|trang)\b/gi)].map(m=>Number(m[1])).filter(n=>n>0&&n<=1000);pageCount=ms.length?Math.max(...ms):0;}
// 4. Scroll-collect if needed
if(urls.length<2){
const h=document.body.scrollHeight;
for(let y=0;y<h;y+=800){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,150));}
window.scrollTo(0,0);await new Promise(r=>setTimeout(r,500));
const s=[...document.querySelectorAll('img')].filter(img=>{const r=img.getBoundingClientRect(),nw=img.naturalWidth||0,nh=img.naturalHeight||0;if(img.closest('header,footer,nav,aside,[role="navigation"]'))return false;return (r.width>240&&r.height>320)||(nw>600&&nh>700)||/document|page|preview/i.test(img.currentSrc||img.src||'');}).flatMap(img=>[img.currentSrc||img.src||img.dataset.src||'',...(img.srcset?img.srcset.split(',').map(p=>p.trim().split(' ')[0]):[])]).filter(s=>s.startsWith('http')&&(s.includes('cloudfront')||s.includes('studocu'))&&!/\.(js|css|html|svg|json|woff2?)(\?|$)/i.test(s)&&!/logo|icon|avatar|badge|sprite|profile|placeholder|tracking/i.test(s)&&(/\.(jpg|jpeg|png|webp)(\?|$)/i.test(s)||/document|page|pages|preview/i.test(s)));
urls=[...new Set(s)];}
if(pageCount&&urls.length>pageCount)urls=urls.slice(0,pageCount);
// 5. Done
const title=document.querySelector('h1')?.textContent?.trim()||document.title;
t.innerHTML='<b>\\u2705 STool</b><br>T\\u00ecm th\\u1ea5y '+urls.length+' trang — \\u0110ang g\\u1eedi...';
setTimeout(()=>{if(t.parentNode)t.remove();},3000);
// 6. Send via postMessage (no CORS, no mixed-content issues)
const msg={type:'STOOL_IMPORT',urls,title,sourceUrl:location.href,pageCount:pageCount||null};
const send=()=>{if(iw&&!iw.closed)iw.postMessage(msg,S);};
send();setTimeout(send,1000);setTimeout(send,2500);setTimeout(send,5000);
})();`;

const BOOKMARKLET_CODE = String.raw`(async function(){try{
const S='http://localhost:3000';
const iw=window.open(S+'/import.html','stool_import');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let renderReady=false;
let renderJobId=null;
let finishError=null;
let fastAccepted=false;
let fastRejected=null;
const pendingPages=new Map();
window.addEventListener('message',e=>{
 if(e.origin!==S||!e.data)return;
 if(e.data.type==='STOOL_FAST_ACCEPTED'){fastAccepted=true;renderJobId=e.data.jobId;}
 if(e.data.type==='STOOL_FAST_REJECTED'){fastRejected=e.data.error||'Fast mode failed';}
 if(e.data.type==='STOOL_RENDER_READY'){renderReady=true;renderJobId=e.data.jobId;}
 if(e.data.type==='STOOL_RENDER_PAGE_OK'&&pendingPages.has(e.data.index)){pendingPages.get(e.data.index).resolve(e.data);pendingPages.delete(e.data.index);}
 if(e.data.type==='STOOL_RENDER_PAGE_ERROR'&&pendingPages.has(e.data.index)){pendingPages.get(e.data.index).reject(new Error(e.data.error||'Upload page failed'));pendingPages.delete(e.data.index);}
 if(e.data.type==='STOOL_RENDER_FINISH_ERROR')finishError=new Error(e.data.error||'Finish failed');
});
const t=document.createElement('div');
t.id='stool-toast';
t.style='position:fixed;top:16px;right:16px;background:linear-gradient(135deg,#6366f1,#06b6d4);color:white;padding:12px 18px;border-radius:12px;z-index:2147483647;font:500 14px system-ui;box-shadow:0 8px 32px rgba(0,0,0,.4);line-height:1.5;max-width:360px';
t.innerHTML='<b>STool v2</b><br>Dang tai bo chup trang...';
document.body.appendChild(t);
let pageCount=0;
const text=document.body.innerText||'';
const nums=[...text.matchAll(/(\d{1,4})\s*(?:pages?|trang)/gi)].map(m=>Number(m[1])).filter(n=>n>0&&n<=1000);
if(nums.length)pageCount=Math.max(...nums);
const title=document.querySelector('h1')?.textContent?.trim()||document.title||'studocu_document';
function compactScripts(){
 const out=[];
 let total=0;
 for(const s of Array.from(document.scripts)){
  const txt=s.textContent||'';
  if(txt.length<20)continue;
  if(!/studocu|cloudfront|doc-assets|document|page|preview|image|__NEXT_DATA__/i.test(txt))continue;
  const part=txt.slice(0,450000);
  out.push(part);
  total+=part.length;
  if(total>1600000)break;
 }
 return out;
}
function collectFastPayload(){
 const imgs=Array.from(document.images).map(img=>({src:img.currentSrc||img.src||'',srcset:img.srcset||'',width:img.naturalWidth||img.width||0,height:img.naturalHeight||img.height||0})).filter(x=>x.src||x.srcset).slice(0,1200);
 const resources=(performance.getEntriesByType?performance.getEntriesByType('resource'):[]).map(r=>({name:r.name,initiatorType:r.initiatorType||''})).filter(r=>/studocu|cloudfront|doc-assets|image|page|preview/i.test(r.name)).slice(0,1600);
 const links=Array.from(document.querySelectorAll('a[href],link[href]')).map(a=>a.href).filter(Boolean).filter(h=>/studocu|cloudfront|doc-assets|pdf|download|document/i.test(h)).slice(0,1200);
 const stylesheets=Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]')).map(a=>a.href).filter(Boolean).slice(0,300);
 const inlineStyles=Array.from(document.querySelectorAll('style')).map(s=>(s.textContent||'').slice(0,120000)).filter(t=>/studocu|doc-assets|url\(/i.test(t)).slice(0,80);
 const backgrounds=[];
 Array.from(document.querySelectorAll('main *,article *,section *,div')).slice(0,2500).forEach(e=>{
  const bg=getComputedStyle(e).backgroundImage;
  if(bg&&bg!=='none'&&/url\(/i.test(bg))backgrounds.push(bg);
 });
 return {
  type:'STOOL_FAST_IMPORT',
  title,
  sourceUrl:location.href,
  pageCount:pageCount||null,
  nextData:document.getElementById('__NEXT_DATA__')?.textContent||'',
  scripts:compactScripts(),
  images:imgs,
  resources,
  links,
  stylesheets,
  inlineStyles,
  backgrounds:backgrounds.slice(0,500)
 };
}
async function tryHtmlPrintMode(reason){
 const sourceRoot=document.querySelector('.p2hv')||document.querySelector('#page-container')||document.querySelector('[class*="page-container"]');
 if(!sourceRoot)return false;
 const oldY=scrollY;
 const totalH=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
 t.innerHTML='<b>STool v2</b><br>Dang nap cac trang HTML...';
 for(let y=0;y<totalH;y+=1400){window.scrollTo(0,y);await wait(70);}
 window.scrollTo(0,oldY);await wait(250);
 const pageNodes=Array.from(document.querySelectorAll('.pf')).filter(p=>{
  const r=p.getBoundingClientRect();
  const cs=getComputedStyle(p);
  return r.width>250&&r.height>250&&cs.display!=='none'&&cs.visibility!=='hidden';
 });
 if(!pageNodes.length)return false;
 if(pageCount&&pageNodes.length<Math.max(1,Math.ceil(pageCount*.65))){
  t.innerHTML='<b>STool v2</b><br>HTML print chi thay '+pageNodes.length+'/'+pageCount+' trang dang truy cap duoc.';
  return false;
 }
 const old=document.getElementById('stool-html-print');
 if(old)old.remove();
 const overlay=document.createElement('div');
 overlay.id='stool-html-print';
 overlay.style='position:fixed;inset:0;z-index:2147483646;background:#111827;color:#111;overflow:auto;padding:72px 20px 32px;font-family:system-ui,sans-serif';
 const toolbar=document.createElement('div');
 toolbar.id='stool-print-toolbar';
 toolbar.style='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#0f172a;color:white;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px 16px;box-shadow:0 8px 24px rgba(0,0,0,.25)';
 toolbar.innerHTML='<strong>STool HTML PDF</strong><span>'+pageNodes.length+' trang</span><button id="stool-print-save" style="border:0;border-radius:8px;background:#2563eb;color:white;font-weight:700;padding:9px 14px;cursor:pointer">Save as PDF</button><button id="stool-print-close" style="border:1px solid rgba(255,255,255,.35);border-radius:8px;background:transparent;color:white;font-weight:700;padding:8px 12px;cursor:pointer">Close</button>';
 const content=document.createElement('div');
 content.id='stool-print-content';
 content.style='display:flex;flex-direction:column;align-items:center;gap:18px';
 for(const p of pageNodes){
  const clone=p.cloneNode(true);
  clone.classList.add('stool-print-page');
  clone.style.margin='0 auto';
  clone.style.position='relative';
  clone.style.transform='none';
  clone.style.boxShadow='0 10px 32px rgba(0,0,0,.28)';
  clone.querySelectorAll('script,iframe,video').forEach(n=>n.remove());
  content.appendChild(clone);
 }
 const style=document.createElement('style');
 style.textContent='@media print{body>*:not(#stool-html-print){display:none!important}#stool-html-print{position:static!important;inset:auto!important;overflow:visible!important;background:white!important;padding:0!important;color:#111!important}#stool-print-toolbar{display:none!important}#stool-print-content{display:block!important}.stool-print-page{break-after:page;page-break-after:always;box-shadow:none!important;margin:0 auto!important}@page{margin:0}}';
 overlay.appendChild(style);
 overlay.appendChild(toolbar);
 overlay.appendChild(content);
 document.body.appendChild(overlay);
 toolbar.querySelector('#stool-print-save').onclick=()=>window.print();
 toolbar.querySelector('#stool-print-close').onclick=()=>overlay.remove();
 t.innerHTML='<b>STool v2</b><br>Da tao ban in HTML '+pageNodes.length+' trang. Chon Save as PDF.';
 if(iw&&!iw.closed)iw.postMessage({type:'STOOL_PRINT_MODE',pages:pageNodes.length,reason:reason||''},S);
 setTimeout(()=>window.print(),600);
 return true;
}
t.innerHTML='<b>STool v2</b><br>Dang thu fast mode...';
const fastMsg=collectFastPayload();
const sendFast=()=>{if(iw&&!iw.closed)iw.postMessage(fastMsg,S);};
sendFast();setTimeout(sendFast,600);
for(let n=0;n<35&&!fastAccepted&&!fastRejected;n++){await wait(200);}
if(fastAccepted){
 t.innerHTML='<b>STool v2</b><br>Fast mode da nhan job, dang tai song song tren server...';
 setTimeout(()=>t.remove(),3000);
 return;
}
const useRenderFallback=false;
if(!useRenderFallback){
 if(await tryHtmlPrintMode(fastRejected))return;
 const msg=fastRejected||'Fast proxy khong du nguon sach. Tai lieu nay can PDF/source goc hoac goi trang day du, khong render tung anh.';
 t.innerHTML='<b>STool v2</b><br>'+msg;
 if(iw&&!iw.closed)iw.postMessage({type:'STOOL_RENDER_FATAL',error:msg},S);
 return;
}
t.innerHTML='<b>STool v2</b><br>Fast mode khong du du lieu, chuyen sang render fallback...';
if(iw&&!iw.closed)iw.postMessage({type:'STOOL_RENDER_FALLBACK_START',message:'Fast mode khong du du lieu. Dang khoi dong render fallback...'},S);
await wait(900);
async function loadScript(src){
 const s=document.createElement('script');
 s.src=src;
 s.referrerPolicy='no-referrer';
 document.documentElement.appendChild(s);
 await new Promise((ok,fail)=>{s.onload=ok;s.onerror=fail;setTimeout(()=>fail(new Error('timeout')),12000);});
}
if(!window.html2canvas){
 const cdns=[
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js'
 ];
 let loaded=false;
 for(const src of cdns){try{await loadScript(src);loaded=!!window.html2canvas;if(loaded)break;}catch(e){}}
 if(!loaded){
  if(iw&&!iw.closed)iw.postMessage({type:'STOOL_RENDER_FALLBACK_START',message:'Khong tai duoc html2canvas, dang dung renderer noi bo...'},S);
 }
}
function hideNoise(root=document){
 root.querySelectorAll('[role="dialog"],[aria-modal="true"]').forEach(e=>e.style.display='none');
 Array.from(root.body?root.body.querySelectorAll('*'):root.querySelectorAll('*')).forEach(e=>{
  const cs=getComputedStyle(e);
  const z=parseInt(cs.zIndex||'0',10);
  const tx=(e.innerText||'').slice(0,160);
  if((cs.position==='fixed'||cs.position==='sticky')&&(z>10||/This is a preview|unlock all|Premium|Free Trial|Cookie|Sign up|Log in/i.test(tx)))e.style.visibility='hidden';
 });
}
hideNoise(document);
Array.from(document.body.querySelectorAll('*')).forEach(e=>{
 const cs=getComputedStyle(e);
 const z=parseInt(cs.zIndex||'0',10);
 const tx=(e.innerText||'').slice(0,120);
 if((cs.position==='fixed'||cs.position==='sticky')&&(z>10||/This is a preview|unlock all|Premium|Free Trial/i.test(tx)))e.style.visibility='hidden';
});
function roughPageCount(){
 const sel='[data-test-selector*="page"],[data-testid*="page"],[data-page-number],[data-page],[id*="page"],[class*="page"],[class*="Page"],[class*="document"],[class*="Document"],article,main section';
 return Array.from(document.querySelectorAll(sel)).filter(e=>{
  const r=e.getBoundingClientRect();
  const cs=getComputedStyle(e);
  return r.width>=300&&r.height>=300&&cs.display!=='none'&&cs.visibility!=='hidden';
 }).length;
}
let h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
let lastH=0,lastRough=0,stablePasses=0;
for(let pass=0;pass<7;pass++){
 h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
 for(let y=0;y<h;y+=1200){
  t.innerHTML='<b>STool v2</b><br>Dang nap noi dung trang... '+Math.min(100,Math.round((y/h)*100))+'%';
  window.scrollTo(0,y);
  await wait(95);
 }
 window.scrollTo(0,Math.max(0,h-innerHeight));await wait(220);
 const nowH=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
 const nowRough=roughPageCount();
 if(pageCount&&nowRough>=pageCount)break;
 if(Math.abs(nowH-lastH)<80&&nowRough<=lastRough)stablePasses++;else stablePasses=0;
 lastH=nowH;lastRough=nowRough;
 if(stablePasses>=2)break;
}
h=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
window.scrollTo(0,0);await wait(500);
function elTop(e){return e.getBoundingClientRect().top+scrollY;}
function visibleCandidate(e){
 if(e===document.body||e===document.documentElement)return false;
 const r=e.getBoundingClientRect();
 if(r.width<260||r.height<260||r.width>1900||r.height>2600)return false;
 const cs=getComputedStyle(e);
 if(cs.display==='none'||cs.visibility==='hidden'||cs.opacity==='0')return false;
 if(e.closest('header,footer,nav,aside,[role="navigation"]'))return false;
 const tx=(e.innerText||'').trim();
 if(!e.querySelector('img,canvas,svg,p,span')&&tx.length<10)return false;
 return true;
}
function scoreCandidate(e){
 const r=e.getBoundingClientRect();
 const cs=getComputedStyle(e);
 const idc=((e.id||'')+' '+(e.className||'')+' '+Array.from(e.attributes||[]).map(a=>a.name+'='+a.value).join(' ')).toString();
 let s=0;
 if(/page|document|preview|paper|reader|sheet|canvas/i.test(idc))s+=6;
 if(e.querySelector('img,canvas,svg'))s+=4;
 if((e.innerText||'').trim().length>30)s+=2;
 if(/rgb\(255,\s*255,\s*255\)|#fff|white/i.test(cs.backgroundColor))s+=2;
 if(r.width>=420&&r.height>=520)s+=4;
 const ratio=r.width/r.height;
 if(ratio>.45&&ratio<1.25)s+=3;
 if(r.left>80&&r.right<innerWidth-20)s+=1;
 return s;
}
const selectorCandidates=Array.from(document.querySelectorAll('[data-test-selector*="page"],[data-testid*="page"],[data-page-number],[data-page],[id*="page"],[class*="page"],[class*="Page"],[class*="document"],[class*="Document"],[class*="preview"],article,article section,main section,main div'));
const mediaCandidates=Array.from(document.querySelectorAll('img,canvas,svg')).map(e=>e.closest('section,article,div')||e);
const geometryCandidates=Array.from(document.querySelectorAll('main *')).filter(e=>{
 const r=e.getBoundingClientRect();
 return r.width>=360&&r.height>=420;
});
let raw=[...new Set([...selectorCandidates,...mediaCandidates,...geometryCandidates])];
let pages=raw.filter(visibleCandidate).map(e=>({kind:'element',el:e,score:scoreCandidate(e),top:elTop(e),area:e.getBoundingClientRect().width*e.getBoundingClientRect().height})).filter(p=>p.score>=5).sort((a,b)=>{
 const at=a.top,bt=b.top;
 if(Math.abs(at-bt)>20)return at-bt;
 if(b.score!==a.score)return b.score-a.score;
 return a.area-b.area;
});
const picked=[];
for(const item of pages){
 const e=item.el;
 const r=e.getBoundingClientRect();
 const area=r.width*r.height;
 const duplicate=picked.findIndex(p=>{
  const pr=p.el.getBoundingClientRect();
  const pa=pr.width*pr.height;
  const sameTop=Math.abs((pr.top+scrollY)-(r.top+scrollY))<55;
  return sameTop&&(p.el.contains(e)||e.contains(p.el)||Math.min(area,pa)/Math.max(area,pa)>.55);
 });
 if(duplicate>=0){
  const old=picked[duplicate],or=old.el.getBoundingClientRect();
  if(item.score>old.score||(item.score===old.score&&area<or.width*or.height))picked[duplicate]=item;
  continue;
 }
 picked.push(item);
}
pages=picked;
if(pageCount&&pages.length>pageCount)pages=pages.slice(0,pageCount);
let fallbackMode=false;
function makeViewportPages(count){
 const result=[];
 const sliceH=Math.min(1150,Math.max(700,Math.floor(h/Math.max(1,count))+120));
 if(count<=1)return [{kind:'viewport',top:0,height:Math.min(sliceH,h)}];
 const maxTop=Math.max(0,h-sliceH);
 for(let i=0;i<count;i++){
  result.push({kind:'viewport',top:Math.round((maxTop*i)/(count-1)),height:sliceH});
 }
 return result;
}
if(pageCount&&pages.length>0&&pages.length<Math.max(1,pageCount-2)){
 fallbackMode=true;
 t.innerHTML='<b>STool v2</b><br>Chi thay '+pages.length+'/'+pageCount+' container. Dang chia lai thanh '+pageCount+' vung chup...';
 await wait(1200);
 pages=makeViewportPages(pageCount);
}
if(!pages.length){
 fallbackMode=true;
 pages=makeViewportPages(pageCount||Math.min(80,Math.max(1,Math.ceil(h/900))));
 if(!pages.length)throw new Error('Khong tim thay noi dung de chup');
}
if(pageCount&&!fallbackMode&&pages.length<Math.max(1,pageCount-2)){t.innerHTML='<b>STool v2</b><br>Chi tim thay '+pages.length+'/'+pageCount+' trang. Van thu chup cac trang dang co...';await wait(1500);}
if(fallbackMode){t.innerHTML='<b>STool v2</b><br>Khong thay container rieng. Dang chuyen sang chup theo vung man hinh ('+pages.length+' vung)...';await wait(1500);}
const expectedPages=pageCount||pages.length;
const startMsg={type:'STOOL_RENDER_START',title,sourceUrl:location.href,pageCount:expectedPages,total:pages.length};
const sendStart=()=>{if(iw&&!iw.closed)iw.postMessage(startMsg,S);};
sendStart();setTimeout(sendStart,500);setTimeout(sendStart,1200);
for(let n=0;n<30&&!renderReady;n++){await wait(200);}
if(!renderReady)throw new Error('Import page chua san sang nhan du lieu');
async function waitImages(el){
 const imgs=Array.from(el.querySelectorAll('img')).filter(img=>img.offsetWidth>10&&img.offsetHeight>10);
 await Promise.all(imgs.map(img=>img.complete&&img.naturalWidth?null:new Promise(r=>{img.addEventListener('load',r,{once:true});img.addEventListener('error',r,{once:true});setTimeout(r,1200);})));
}
function shrinkCanvas(src,maxWidth){
 if(src.width<=maxWidth)return src;
 const c=document.createElement('canvas');
 c.width=maxWidth;
 c.height=Math.round(src.height*(maxWidth/src.width));
 c.getContext('2d').drawImage(src,0,0,c.width,c.height);
 return c;
}
async function captureWithForeignObject(el,target,scale){
 const w=Math.max(1,Math.round((target.kind==='viewport'?document.documentElement.clientWidth:el.getBoundingClientRect().width)*scale));
 const hgt=Math.max(1,Math.round((target.kind==='viewport'?target.height:el.getBoundingClientRect().height)*scale));
 const clone=(el||document.body).cloneNode(true);
 clone.querySelectorAll('script,style,link,iframe,video').forEach(n=>n.remove());
 clone.style.margin='0';
 clone.style.transform='scale('+scale+')';
 clone.style.transformOrigin='top left';
 clone.style.background='#fff';
 clone.style.width=(w/scale)+'px';
 clone.style.minHeight=(hgt/scale)+'px';
 const xml=new XMLSerializer().serializeToString(clone);
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+hgt+'"><foreignObject width="100%" height="100%" x="0" y="0"><div xmlns="http://www.w3.org/1999/xhtml">'+xml+'</div></foreignObject></svg>';
 const img=new Image();
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
 await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;setTimeout(()=>reject(new Error('foreignObject timeout')),12000);});
 const c=document.createElement('canvas');
 c.width=w;c.height=hgt;
 c.getContext('2d').fillStyle='#fff';
 c.getContext('2d').fillRect(0,0,w,hgt);
 c.getContext('2d').drawImage(img,0,0);
 URL.revokeObjectURL(url);
 return c;
}
function postPage(payload){
 return new Promise((resolve,reject)=>{
  pendingPages.set(payload.index,{resolve,reject});
  iw.postMessage(payload,S);
  setTimeout(()=>{if(pendingPages.has(payload.index)){pendingPages.delete(payload.index);reject(new Error('Qua thoi gian gui trang '+(payload.index+1)));}},45000);
 });
}
const uploads=[];
for(let i=0;i<pages.length;i++){
 t.innerHTML='<b>STool v2</b><br>Dang chup trang '+(i+1)+'/'+pages.length+'...';
 const target=pages[i];
 const el=target.el;
 if(target.kind==='viewport')window.scrollTo(0,target.top);
 else el.scrollIntoView({block:'center'});
 await wait(160);
 if(el)await waitImages(el);
 const rect=el?el.getBoundingClientRect():{width:document.documentElement.clientWidth,height:target.height};
 const scale=Math.min(1.22,Math.max(1,1220/Math.max(1,rect.width)));
 let canvas;
 if(window.html2canvas){
  canvas=await html2canvas(el||document.body,{
   backgroundColor:'#ffffff',
   scale,
   useCORS:true,
   allowTaint:false,
   logging:false,
   removeContainer:true,
   x:target.kind==='viewport'?0:undefined,
   y:target.kind==='viewport'?target.top:undefined,
   width:target.kind==='viewport'?document.documentElement.clientWidth:undefined,
   height:target.kind==='viewport'?target.height:undefined,
   scrollX:0,
   scrollY:target.kind==='viewport'?0:-window.scrollY,
   windowWidth:document.documentElement.clientWidth,
   windowHeight:target.kind==='viewport'?target.height:document.documentElement.clientHeight,
   onclone:doc=>hideNoise(doc)
  });
 }else{
  canvas=await captureWithForeignObject(el||document.body,target,scale);
 }
 const out=shrinkCanvas(canvas,1350);
 const image=out.toDataURL('image/jpeg',0.76);
 uploads.push(postPage({type:'STOOL_RENDER_PAGE',jobId:renderJobId,index:i,total:pages.length,image}));
 if(uploads.length>=3)await uploads.shift();
 t.innerHTML='<b>STool v2</b><br>Da gui '+(i+1)+'/'+pages.length+' trang...';
 await wait(25);
}
await Promise.all(uploads);
t.innerHTML='<b>STool v2</b><br>Da gui '+pages.length+' trang, dang tao PDF...';
iw.postMessage({type:'STOOL_RENDER_FINISH',jobId:renderJobId,total:pages.length},S);
await wait(1000);
if(finishError)throw finishError;
setTimeout(()=>t.remove(),3500);
}catch(e){try{if(iw&&!iw.closed)iw.postMessage({type:'STOOL_RENDER_FATAL',error:(e&&e.message?e.message:String(e))},S);}catch(_){}alert('STool v2 loi: '+(e&&e.message?e.message:e));}})();`;


/* ─── DOM Elements ──────────────────────────────────────────────────────────── */
const urlInput        = document.getElementById('studocu-url');
const downloadBtn     = document.getElementById('download-btn');
const pasteBtn        = document.getElementById('paste-btn');
const inputGroup      = document.getElementById('input-group');
const progressSection = document.getElementById('progress-section');
const progressMessage = document.getElementById('progress-message');
const progressPercent = document.getElementById('progress-percent');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressSpinner = document.getElementById('progress-spinner');
const progressIconDone= document.getElementById('progress-icon-done');
const progressIconErr = document.getElementById('progress-icon-error');
const resultSection   = document.getElementById('result-section');
const resultTitle     = document.getElementById('result-title');
const resultMeta      = document.getElementById('result-meta');
const downloadFileBtn = document.getElementById('download-file-btn');
const errorSection    = document.getElementById('error-section');
const errorMessage    = document.getElementById('error-message');
const resetBtn        = document.getElementById('reset-btn');
const resetBtnErr     = document.getElementById('reset-btn-err');
const bookmarkletFallback = null;
const bookmarkletLink = null;
const openStudocuLink = null;

/* ─── State ─────────────────────────────────────────────────────────────────── */
let currentSSE = null;
let currentStudocuUrl = '';

/* ─── Set Bookmarklet href ──────────────────────────────────────────────────── */
function initBookmarklet() {
  // Bookmarklet flow removed intentionally. Direct backend mode should fail clearly.
}

/* ─── Check for ?jobId= in URL (from bookmarklet redirect) ─────────────────── */
function checkJobIdInUrl() {
  const params = new URLSearchParams(window.location.search);
  const jobId = params.get('jobId');
  if (!jobId) return;

  // Clean URL without jobId
  window.history.replaceState({}, '', window.location.pathname);

  showToast('📥 Bookmarklet đã gửi dữ liệu! Đang tạo PDF...');
  setUIState('loading');
  updateProgress('Đang nhận dữ liệu từ trình duyệt...', 5);
  connectSSE(jobId);
}

/* ─── Paste Button ──────────────────────────────────────────────────────────── */
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      urlInput.value = text.trim();
      urlInput.dispatchEvent(new Event('input'));
      urlInput.focus();
      flashSuccess(pasteBtn);
    }
  } catch {
    urlInput.focus();
  }
});

function flashSuccess(el) {
  el.style.color = '#10b981';
  setTimeout(() => { el.style.color = ''; }, 1200);
}

/* ─── Input validation ──────────────────────────────────────────────────────── */
function isStudocuUrl(val) {
  return val && /studocu\.[a-z]{2,}/.test(val);
}

urlInput.addEventListener('input', () => {
  const val = urlInput.value.trim();
  downloadBtn.disabled = !isStudocuUrl(val);
  if (isStudocuUrl(val)) currentStudocuUrl = val;
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !downloadBtn.disabled) startDownload();
});

/* ─── Start Download ────────────────────────────────────────────────────────── */
downloadBtn.addEventListener('click', startDownload);

async function startDownload() {
  const url = urlInput.value.trim();
  if (!isStudocuUrl(url)) {
    shakeInput();
    showToast('⚠️ Vui lòng nhập đúng URL từ studocu.com hoặc studocu.vn');
    return;
  }
  currentStudocuUrl = url;
  setUIState('loading');

  try {
    const res = await fetch(`${API_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Không thể bắt đầu quá trình tải');
    connectSSE(data.jobId);
  } catch (err) {
    showError(err.message);
  }
}

/* ─── SSE Progress ──────────────────────────────────────────────────────────── */
function connectSSE(jobId) {
  if (currentSSE) currentSSE.close();
  currentSSE = new EventSource(`${API_BASE}/api/progress/${jobId}`);

  currentSSE.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleProgressUpdate(data);
      if (data.status === 'done' || data.status === 'error') {
        currentSSE.close();
        currentSSE = null;
      }
    } catch { /* ignore */ }
  };

  currentSSE.onerror = () => {
    currentSSE.close();
    currentSSE = null;
    if (progressSection.style.display !== 'none' && progressIconDone.style.display === 'none') {
      showError('Mất kết nối với máy chủ. Vui lòng thử lại.');
    }
  };

  const timeout = setTimeout(() => {
    if (currentSSE) {
      currentSSE.close();
      currentSSE = null;
      showError('Quá thời gian chờ. Tài liệu này có thể quá lớn hoặc không thể tải.');
    }
  }, 4 * 60 * 1000);

  currentSSE.addEventListener('message', () => clearTimeout(timeout));
}

function handleProgressUpdate(data) {
  const { status, message, percent, filename, pages, docTitle } = data;
  updateProgress(message, percent || 0);

  if (status === 'done') {
    progressSpinner.style.display = 'none';
    progressIconDone.style.display = 'block';
    updateProgress(message, 100);
    setTimeout(() => showResult(filename, docTitle, pages), 800);

  } else if (status === 'error') {
    progressSpinner.style.display = 'none';
    progressIconErr.style.display = 'block';
    const isCFError = /cloudflare|CF|bot|block|captcha|playwright|chromium|chrome\.exe|spawn EPERM|Windows dang chan/i.test(message);
    setTimeout(() => showError(message, isCFError), 600);
  }
}

function updateProgress(message, percent) {
  progressMessage.textContent = message;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressBarFill.style.width = `${percent}%`;
}

/* ─── UI State Management ───────────────────────────────────────────────────── */
function setUIState(state) {
  progressSection.style.display = 'none';
  resultSection.style.display   = 'none';
  errorSection.style.display    = 'none';
  if (bookmarkletFallback) bookmarkletFallback.style.display = 'none';

  if (state === 'loading') {
    inputGroup.style.display = 'none';
    progressSection.style.display = 'block';
    progressSpinner.style.display = 'flex';
    progressIconDone.style.display = 'none';
    progressIconErr.style.display  = 'none';
    updateProgress('Đang khởi động...', 0);
  } else if (state === 'idle') {
    inputGroup.style.display = 'flex';
  }
}

function showResult(filename, docTitle, pages) {
  progressSection.style.display = 'none';
  resultSection.style.display   = 'block';
  resultTitle.textContent = docTitle || 'Tài liệu Studocu';
  resultMeta.textContent  = `PDF · ${pages || '?'} trang · Sẵn sàng tải`;
  downloadFileBtn.href = `${API_BASE}/api/file/${encodeURIComponent(filename)}`;
  downloadFileBtn.setAttribute('download', filename);
}

function showError(msg, showBookmarklet = false) {
  setUIState('idle');
  errorSection.style.display = 'block';
  errorMessage.textContent = msg || 'Đã xảy ra lỗi không xác định.';

  // Auto-show bookmarklet if it's a CF/block error OR if explicitly requested
  const cfKeywords = /cloudflare|cf|bot|block|captcha|playwright|chromium|chrome\.exe|spawn EPERM|Windows dang chan|vượt|bảo mật|resolve/i;
  if (bookmarkletFallback && (showBookmarklet || cfKeywords.test(msg))) {
    bookmarkletFallback.style.display = 'block';
    // Update the "open studocu" link with current URL
    if (openStudocuLink && currentStudocuUrl) {
      openStudocuLink.href = currentStudocuUrl;
    }
  }
}

/* ─── Reset ─────────────────────────────────────────────────────────────────── */
resetBtn.addEventListener('click', resetUI);
resetBtnErr.addEventListener('click', resetUI);

function resetUI() {
  if (currentSSE) { currentSSE.close(); currentSSE = null; }
  urlInput.value = '';
  downloadBtn.disabled = true;
  setUIState('idle');
  progressSection.style.display = 'none';
  resultSection.style.display   = 'none';
  errorSection.style.display    = 'none';
  inputGroup.style.display = 'flex';
  urlInput.focus();
}

/* ─── Shake / Toast ─────────────────────────────────────────────────────────── */
function shakeInput() {
  const wrapper = document.querySelector('.url-input-wrapper');
  wrapper.style.animation = 'shake 0.4s ease';
  wrapper.addEventListener('animationend', () => { wrapper.style.animation = ''; }, { once: true });
}

function showToast(msg) {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
      background:rgba(20,20,40,0.95);color:#f1f5f9;border:1px solid rgba(99,102,241,0.4);border-radius:12px;
      padding:12px 24px;font-size:0.875rem;font-family:'Inter',sans-serif;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:9999;
      transition:transform 0.3s cubic-bezier(0.4,0,0.2,1),opacity 0.3s;opacity:0;pointer-events:none;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.transform = 'translateX(-50%) translateY(0)';
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(80px)';
    toast.style.opacity = '0';
  }, 3500);
}

/* ─── Inject Shake Keyframes ────────────────────────────────────────────────── */
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)} 20%{transform:translateX(-6px)}
    40%{transform:translateX(6px)} 60%{transform:translateX(-4px)} 80%{transform:translateX(4px)}
  }`;
document.head.appendChild(shakeStyle);

/* ─── Scroll Animations ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.step-card, .feature-card').forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity 0.5s ease ${i * 0.08}s, transform 0.5s ease ${i * 0.08}s`;
  });
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.style.opacity = '1';
        e.target.style.transform = 'translateY(0)';
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.step-card, .feature-card').forEach(el => obs.observe(el));
});

/* ─── Init ───────────────────────────────────────────────────────────────────── */
downloadBtn.disabled = true;
