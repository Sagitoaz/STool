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

const BOOKMARKLET_CODE = BOOKMARKLET_CODE_OLD;


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
const bookmarkletFallback = document.getElementById('bookmarklet-fallback');
const bookmarkletLink = document.getElementById('bookmarklet-link');
const openStudocuLink = document.getElementById('open-studocu-link');

/* ─── State ─────────────────────────────────────────────────────────────────── */
let currentSSE = null;
let currentStudocuUrl = '';

/* ─── Set Bookmarklet href ──────────────────────────────────────────────────── */
function initBookmarklet() {
  if (!bookmarkletLink) return;
  bookmarkletLink.href = 'javascript:' + BOOKMARKLET_CODE.trim();
  bookmarkletLink.addEventListener('click', (e) => {
    e.preventDefault();
    showToast('🔖 Kéo nút "STool Extractor v2" vào thanh bookmark bar, đừng click trực tiếp!');
  });
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
initBookmarklet();
checkJobIdInUrl();   // Handle redirect from bookmarklet
