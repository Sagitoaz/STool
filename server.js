const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fse = require('fs-extra');
const axios = require('axios');
const { PDFDocument } = require('pdf-lib');

axios.defaults.proxy = false;

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS + Chrome Private Network Access ──────────────────────────────────────
// Chrome 104+ (enforced from ~117) blocks requests from secure origins
// (https://studocu.vn) to localhost unless the server responds with
// Access-Control-Allow-Private-Network: true in the OPTIONS preflight.
//
// The cors() npm package handles OPTIONS internally and may respond before
// our custom middleware runs — so we handle all CORS manually in one place.
app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Cache-Control');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');   // ← KEY header
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');

  // Respond to OPTIONS preflight immediately with all headers above
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '500mb' }));
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || /request entity too large/i.test(err.message || ''))) {
    return res.status(413).json({ success: false, error: 'Payload anh qua lon. Hay thu lai, STool se nen anh nho hon.' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: 'JSON gui len server bi hong hoac qua lon.' });
  }
  next(err);
});
app.use(express.static(path.join(__dirname, 'public')));


const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const LOGS_DIR = path.join(__dirname, 'logs');
const PROFILE_DIR   = path.join(__dirname, 'browser-profile'); // persists CF cookies
fse.ensureDirSync(DOWNLOADS_DIR);
fse.ensureDirSync(LOGS_DIR);
fse.ensureDirSync(PROFILE_DIR);

const sseClients = {};
const jobStates = {};
const renderJobs = {};

function appendLog(filename, line) {
  fse.appendFile(path.join(LOGS_DIR, filename), `[${new Date().toISOString()}] ${line}\n`).catch(() => {});
}

// ─── SSE ──────────────────────────────────────────────────────────────────────
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients[jobId] = res;
  if (jobStates[jobId]) {
    res.write(`data: ${JSON.stringify(jobStates[jobId].data)}\n\n`);
  }
  req.on('close', () => delete sseClients[jobId]);
});

function sendProgress(jobId, data) {
  jobStates[jobId] = { data, updatedAt: Date.now() };
  if (sseClients[jobId]) sseClients[jobId].write(`data: ${JSON.stringify(data)}\n\n`);
  if (data.status === 'error') setTimeout(() => delete jobStates[jobId], 15 * 60 * 1000);
}

// ─── Validate URL ──────────────────────────────────────────────────────────────
function isValidStudocuUrl(url) {
  try {
    const h = new URL(url).hostname;
    return /studocu\.[a-z]{2,}$/.test(h);
  } catch { return false; }
}

// ─── Endpoints ─────────────────────────────────────────────────────────────────
app.post('/api/download', (req, res) => {
  const { url } = req.body;
  if (!url || !isValidStudocuUrl(url))
    return res.status(400).json({ success: false, error: 'URL không hợp lệ. Vui lòng nhập URL từ studocu.com / studocu.vn' });
  const jobId = uuidv4();
  res.json({ success: true, jobId });
  processDocument(jobId, url);
});

app.get('/api/file/:filename', (req, res) => {
  const fp = path.join(DOWNLOADS_DIR, req.params.filename);
  if (!fse.existsSync(fp)) return res.status(404).json({ error: 'File không tồn tại hoặc đã hết hạn' });
  res.download(fp, req.params.filename, err => {
    if (!err) setTimeout(() => fse.remove(fp).catch(() => {}), 60_000);
  });
});

// ─── Extract from Bookmarklet ──────────────────────────────────────────────────
// This endpoint receives image URLs from the bookmarklet running in the user's browser.
// The user's browser already has CF clearance cookies, so the bookmarklet can see
// the actual document page images. We just need to download them from the CDN.
app.post('/api/extract', async (req, res) => {
  const { urls, images, title, sourceUrl, pageCount } = req.body;
  if (images && Array.isArray(images) && images.length > 0) {
    const cleanImages = images.filter(v => typeof v === 'string' && /^data:image\/(png|jpeg|jpg);base64,/i.test(v));
    if (cleanImages.length === 0)
      return res.status(400).json({ success: false, error: 'No rendered page images provided' });
    const jobId = uuidv4();
    res.json({ success: true, jobId });
    processRenderedImages(jobId, cleanImages, title || 'studocu_document', sourceUrl || '');
    return;
  }

  if (!urls || !Array.isArray(urls) || urls.length === 0)
    return res.status(400).json({ success: false, error: 'No image URLs provided' });
  const expectedPages = normalizePageCount(pageCount);
  const cleanUrls = sanitizeImageUrls(urls, expectedPages);
  if (cleanUrls.length === 0)
    return res.status(400).json({ success: false, error: 'Khong tim thay anh trang tai lieu hop le.' });
  const jobId = uuidv4();
  res.json({ success: true, jobId });
  processExtractedUrls(jobId, cleanUrls, title || 'studocu_document', sourceUrl || '', expectedPages);
});

async function processRenderedImages(jobId, imageData, title, sourceUrl) {
  try {
    sendProgress(jobId, { status: 'generating', message: `Dang tao PDF tu ${imageData.length} trang da render...`, percent: 70 });
    await finalizePDF(jobId, imageData, sourceUrl, title);
  } catch (err) {
    console.error(`[Rendered ${jobId}] Error:`, err.message);
    sendProgress(jobId, { status: 'error', message: err.message, percent: 0 });
  }
}

app.post('/api/render/start', (req, res) => {
  const { title, sourceUrl, pageCount, total } = req.body;
  const expectedPages = normalizePageCount(pageCount) || normalizePageCount(total);
  const jobId = uuidv4();
  renderJobs[jobId] = {
    title: title || 'studocu_document',
    sourceUrl: sourceUrl || '',
    expectedPages,
    images: [],
    createdAt: Date.now(),
  };
  appendLog('render-debug.log', `${jobId} start expected=${expectedPages || '?'} total=${total || '?'} title="${title || ''}" url="${sourceUrl || ''}"`);
  res.json({ success: true, jobId });
  sendProgress(jobId, { status: 'receiving', message: `Dang nhan 0/${expectedPages || '?'} trang render...`, percent: 5 });
});

app.post('/api/render/page', (req, res) => {
  const { jobId, index, total, image } = req.body;
  const job = renderJobs[jobId];
  if (!job) return res.status(404).json({ success: false, error: 'Render job not found' });
  if (typeof image !== 'string' || !/^data:image\/(png|jpeg|jpg);base64,/i.test(image)) {
    appendLog('render-debug.log', `${jobId || 'no-job'} page invalid index=${index} type=${typeof image} prefix="${String(image || '').slice(0, 40)}"`);
    return res.status(400).json({ success: false, error: 'Invalid rendered page image' });
  }

  const pageIndex = Number.isInteger(Number(index)) ? Number(index) : job.images.length;
  const byteSize = Math.floor((image.length - image.indexOf(',') - 1) * 0.75);
  job.images[pageIndex] = image;
  const received = job.images.filter(Boolean).length;
  const expected = normalizePageCount(total) || job.expectedPages || received;
  appendLog('render-debug.log', `${jobId} page index=${pageIndex} received=${received}/${expected} bytes=${byteSize}`);
  sendProgress(jobId, {
    status: 'receiving',
    message: `Dang nhan ${received}/${expected} trang render...`,
    percent: Math.min(65, 5 + Math.floor((received / expected) * 60))
  });
  res.json({ success: true, received });
});

app.post('/api/render/finish', (req, res) => {
  const { jobId } = req.body;
  const job = renderJobs[jobId];
  if (!job) return res.status(404).json({ success: false, error: 'Render job not found' });
  const images = job.images.filter(Boolean);
  if (images.length === 0) return res.status(400).json({ success: false, error: 'No rendered pages received' });
  const expected = job.expectedPages || images.length;
  if (job.expectedPages && images.length < Math.max(1, job.expectedPages - 2)) {
    appendLog('render-debug.log', `${jobId} finish refused received=${images.length}/${job.expectedPages}`);
    return res.status(400).json({ success: false, error: `Server chi nhan ${images.length}/${job.expectedPages} trang. Hay bam bookmark lai sau khi trang Studocu load xong.` });
  }
  appendLog('render-debug.log', `${jobId} finish received=${images.length}/${expected}`);
  res.json({ success: true, jobId });
  delete renderJobs[jobId];
  processRenderedImages(jobId, images, job.title, job.sourceUrl);
});

async function processExtractedUrls(jobId, imageUrls, title, sourceUrl, expectedPages) {
  try {
    const pageText = expectedPages ? `${imageUrls.length}/${expectedPages}` : imageUrls.length;
    sendProgress(jobId, { status: 'downloading', message: `Dang tai ${pageText} trang tai lieu...`, percent: 10 });
    const imageData = await downloadCDNImages(imageUrls, jobId, sourceUrl);
    if (imageData.length === 0) throw new Error('Không thể tải được ảnh nào từ tài liệu.');
    await finalizePDF(jobId, imageData, sourceUrl, title);
  } catch (err) {
    console.error(`[Extract ${jobId}] Error:`, err.message);
    sendProgress(jobId, { status: 'error', message: err.message, percent: 0 });
  }
}

// ─── Main Process ──────────────────────────────────────────────────────────────
async function processDocument(jobId, url) {
  try {
    sendProgress(jobId, { status: 'start', message: 'Đang xử lý...', percent: 5 });

    // ── Strategy A: Direct HTTP fetch (no browser) ──────────────────────────
    sendProgress(jobId, { status: 'fetching', message: '🔍 Đang thử tải trực tiếp (không cần trình duyệt)...', percent: 10 });
    const directImages = await tryDirectFetch(url, jobId);

    if (directImages && directImages.length > 0) {
      console.log(`[Job ${jobId}] Strategy A success: ${directImages.length} images`);
      await finalizePDF(jobId, directImages, url);
      return;
    }

    // ── Strategy B: Playwright with persistent context ──────────────────────
    console.log(`[Job ${jobId}] Strategy A failed → Strategy B: Playwright`);
    sendProgress(jobId, { status: 'launching', message: '🌐 Khởi động trình duyệt (lần đầu có thể chậm)...', percent: 18 });
    await tryPlaywright(jobId, url);

  } catch (err) {
    console.error(`[Job ${jobId}] Fatal:`, err.message);
    sendProgress(jobId, { status: 'error', message: formatDownloadError(err), percent: 0 });
  }
}

function formatDownloadError(err) {
  const message = err && err.message ? err.message : String(err);
  if (/spawn\s+EPERM|launchPersistentContext|chrome\.exe/i.test(message)) {
    return 'Windows dang chan Playwright mo Chromium (spawn EPERM). Hay dung bookmarklet tren trang Studocu, hoac mo khoa/quarantine file Chromium trong antivirus/Windows Security.';
  }
  return message;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRATEGY A – Direct HTTP + Parse __NEXT_DATA__
// ═══════════════════════════════════════════════════════════════════════════════

async function tryDirectFetch(url, jobId) {
  try {
    const html = await fetchPage(url);
    if (!html) return null;

    // Check CF block
    if (html.includes('cf-browser-verification') || html.includes('Just a moment')) {
      console.log('[Strategy A] Cloudflare blocked direct fetch');
      return null;
    }

    // Extract __NEXT_DATA__ JSON
    const images = parseNextData(html) || parseAlternatePatterns(html);
    if (!images || images.length === 0) return null;

    // Download CDN images (CloudFront has no CF protection)
    const imageData = await downloadCDNImages(images, jobId);
    return imageData;

  } catch (err) {
    console.log('[Strategy A] Error:', err.message);
    return null;
  }
}

async function fetchPage(url) {
  try {
    const { data, status } = await axios.get(url, {
      timeout: 30000,
      decompress: true,
      proxy: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        'sec-ch-ua': '"Chromium";v="124","Google Chrome";v="124","Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
      maxRedirects: 5,
    });
    return status === 200 ? data : null;
  } catch { return null; }
}

function parseNextData(html) {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]);
    const pageCount = findDeclaredPageCount(data);
    return findPageImagesInJson(data, pageCount);
  } catch { return null; }
}

function findPageImagesInJson(obj, expectedPages) {
  const candidates = [];
  collectImageCandidates(obj, candidates, 0);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scoreImageList(b.urls, expectedPages) - scoreImageList(a.urls, expectedPages));
  return sanitizeImageUrls(candidates[0].urls, expectedPages);
}

function collectImageCandidates(obj, candidates, depth) {
  if (depth > 20 || !obj || typeof obj !== 'object') return;

  if (Array.isArray(obj) && obj.length > 0) {
    const props = ['image_url', 'imageUrl', 'url', 'src', 'thumbnail_url', 'thumbnail', 'img', 'page_url', 'originalUrl'];
    const urls = [];

    for (const item of obj) {
      if (typeof item === 'string') urls.push(item);
      else if (item && typeof item === 'object') {
        for (const prop of props) {
          if (typeof item[prop] === 'string') urls.push(item[prop]);
        }
      }
    }

    const clean = sanitizeImageUrls(urls);
    if (clean.length > 1) candidates.push({ urls: clean });
  }

  for (const key of Object.keys(obj)) {
    collectImageCandidates(obj[key], candidates, depth + 1);
  }
}

function findDeclaredPageCount(obj, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;
  const keys = ['pageCount', 'pagesCount', 'numberOfPages', 'numPages', 'totalPages', 'total_pages'];

  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (keys.includes(key) || /^(pages|page_count|pageCount)$/i.test(key)) {
      const n = normalizePageCount(val);
      if (n) return n;
    }
  }

  for (const key of Object.keys(obj)) {
    const found = findDeclaredPageCount(obj[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizePageCount(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : null;
}

function scoreImageList(urls, expectedPages) {
  let score = urls.length * 10;
  if (expectedPages) score -= Math.abs(urls.length - expectedPages) * 8;
  for (const url of urls) score += scoreImageUrl(url);
  return score;
}

function scoreImageUrl(raw) {
  const url = cleanImageUrl(raw);
  if (!url) return -100;
  let score = 0;
  if (/cloudfront|studocu/i.test(url)) score += 8;
  if (/\.(jpg|jpeg|png|webp)(?:[?#]|$)/i.test(url)) score += 10;
  if (/document|page|preview|pages/i.test(url)) score += 8;
  if (/thumb|thumbnail|small|avatar|logo|icon|badge|sprite|profile/i.test(url)) score -= 25;
  if (/\.(js|css|html|svg|json)(?:[?#]|$)/i.test(url)) score -= 50;
  return score;
}

function sanitizeImageUrls(urls, expectedPages) {
  const seen = new Set();
  const clean = [];

  for (const raw of urls || []) {
    const url = cleanImageUrl(raw);
    if (!isImageUrl(url)) continue;
    const key = imageDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(url);
  }

  clean.sort((a, b) => {
    const pa = extractPageNumber(a);
    const pb = extractPageNumber(b);
    if (pa && pb && pa !== pb) return pa - pb;
    return 0;
  });

  return expectedPages && clean.length > expectedPages ? clean.slice(0, expectedPages) : clean;
}

function cleanImageUrl(raw) {
  if (typeof raw !== 'string') return null;
  const url = raw
    .replace(/&amp;/g, '&')
    .trim()
    .split(/\s+/)[0]
    .replace(/[),;]+$/g, '');
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function imageDedupeKey(raw) {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(width|height|w|h|quality|q|format|output-format|auto|fit|dpr)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return `${url.hostname}${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return raw;
  }
}

function extractPageNumber(raw) {
  const patterns = [
    /(?:page|pages|p)[_/-]?(\d{1,4})(?=[^\d]|$)/i,
    /(?:^|[^\d])(\d{1,4})\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const n = match && Number(match[1]);
    if (Number.isInteger(n) && n > 0 && n <= 1000) return n;
  }
  return null;
}

function isImageUrl(s) {
  if (!s) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  if (!/(cloudfront|studocu)/i.test(s)) return false;
  if (/\.(js|css|html|svg|json|woff2?)(?:[?#]|$)/i.test(s)) return false;
  if (/logo|icon|avatar|badge|sprite|profile|placeholder|tracking/i.test(s)) return false;
  return /\.(jpg|jpeg|png|webp)(?:[?#]|$)/i.test(s) || /document|page|pages|preview/i.test(s);
}

function parseAlternatePatterns(html) {
  const urls = [];
  const re = /https?:\/\/[^"'\s<>]+(?:cloudfront|studocu)[^"'\s<>]+/gi;
  let m;
  while ((m = re.exec(html)) !== null) urls.push(m[0]);
  const clean = sanitizeImageUrls(urls);
  return clean.length > 0 ? clean : null;
}

async function downloadCDNImages(imageUrls, jobId, referer = 'https://www.studocu.com/') {
  const results = [];
  imageUrls = sanitizeImageUrls(imageUrls);
  const total = imageUrls.length;
  const stats = { failed: 0, nonImage: 0, tiny: 0, unsupported: 0 };
  const debugLines = [`job=${jobId} total=${total} referer=${referer}`];
  if (imageUrls[0]) debugLines.push(`firstUrl=${imageUrls[0]}`);
  sendProgress(jobId, { status: 'downloading', message: `Đang tải ${total} trang từ CDN...`, percent: 30 });

  for (let i = 0; i < total; i++) {
    sendProgress(jobId, {
      status: 'downloading',
      message: `Đang tải trang ${i + 1}/${total}...`,
      percent: 30 + Math.floor((i / total) * 45)
    });
    try {
      const { data, headers, finalUrl } = await fetchFirstUsableImageUrl(imageUrls[i], referer);
      const bytes = Buffer.from(data);
      const mime = detectImageMime(bytes, headers['content-type']);
      if (i < 3) {
        debugLines.push(`sample${i+1}: url=${finalUrl} ct=${headers['content-type'] || ''} bytes=${bytes.length} mime=${mime || ''} sig=${bytes.subarray(0, 16).toString('hex')}`);
      }
      if (!mime) {
        stats.nonImage++;
        console.warn(`[CDN] Skip non-image ${i+1}: ${headers['content-type'] || 'unknown'}`);
        continue;
      }
      if (bytes.length < 8000) {
        stats.tiny++;
        console.warn(`[CDN] Skip tiny image ${i+1}`);
        continue;
      }
      if (!['image/jpeg', 'image/png'].includes(mime)) {
        stats.unsupported++;
        console.warn(`[CDN] Skip unsupported image ${i+1}: ${mime}`);
        continue;
      }
      const b64 = bytes.toString('base64');
      results.push(`data:${mime};base64,${b64}`);
    } catch (e) {
      stats.failed++;
      console.warn(`[CDN] Skip image ${i+1}:`, e.message);
    }
  }
  if (results.length === 0) {
    console.warn(`[CDN] No usable images. total=${total}`, stats);
  }
  debugLines.push(`result=${results.length} stats=${JSON.stringify(stats)}`);
  await fse.appendFile(path.join(LOGS_DIR, 'cdn-debug.log'), `${new Date().toISOString()}\n${debugLines.join('\n')}\n\n`).catch(() => {});
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STRATEGY B – Playwright with Persistent Context (saves CF cookies to disk)
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchFirstUsableImageUrl(rawUrl, referer) {
  let lastError;
  for (const url of buildImageDownloadCandidates(rawUrl)) {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 20000,
        proxy: false,
        maxRedirects: 5,
        validateStatus: status => status >= 200 && status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Referer': referer || 'https://www.studocu.com/',
        },
      });
      return { data: res.data, headers: res.headers, finalUrl: url };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No image URL candidates');
}

function buildImageDownloadCandidates(rawUrl) {
  const candidates = [];
  const add = url => {
    if (url && !candidates.includes(url)) candidates.push(url);
  };
  add(rawUrl);

  try {
    const parsed = new URL(rawUrl);
    for (const key of ['format', 'output-format', 'fm']) {
      if (/webp/i.test(parsed.searchParams.get(key) || '')) {
        const jpg = new URL(parsed.href);
        jpg.searchParams.set(key, 'jpg');
        add(jpg.href);
        const png = new URL(parsed.href);
        png.searchParams.set(key, 'png');
        add(png.href);
      }
    }

    if (/\.webp$/i.test(parsed.pathname)) {
      for (const ext of ['.jpg', '.jpeg', '.png']) {
        const alt = new URL(parsed.href);
        alt.pathname = alt.pathname.replace(/\.webp$/i, ext);
        add(alt.href);
      }
    }
  } catch {}

  return candidates;
}

function detectImageMime(bytes, contentType = '') {
  const ct = String(contentType).split(';')[0].trim().toLowerCase();
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'image/jpeg';
  if (ct === 'image/png') return 'image/png';
  if (ct === 'image/webp') return 'image/webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 12 &&
      bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function tryPlaywright(jobId, url) {
  // Lazy-load playwright so startup is fast
  const { chromium } = require('playwright');
  let context = null;

  try {
    // launchPersistentContext saves ALL cookies (including CF clearance) to PROFILE_DIR
    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,900',
        '--start-minimized',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'vi-VN',
      extraHTTPHeaders: {
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Chromium";v="124","Google Chrome";v="124","Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    });

    const page = await context.newPage();

    // ── Stealth patches ─────────────────────────────────────────────────────
    await page.addInitScript(() => {
      // Remove automation fingerprints
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      try { delete Object.getPrototypeOf(navigator).webdriver; } catch {}
      // Fake Chrome runtime
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
      // Fake plugins & languages
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
      // Fix permissions
      const origQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (params) =>
        params.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery(params);
    });

    sendProgress(jobId, { status: 'loading', message: 'Đang mở trang Studocu...', percent: 25 });

    // Intercept and capture image responses from Studocu CDN
    const capturedImages = [];
    page.on('response', async response => {
      const respUrl = response.url();
      const ct = response.headers()['content-type'] || '';
      if (ct.startsWith('image/') && (respUrl.includes('cloudfront') || respUrl.includes('studocu')) &&
          !respUrl.includes('logo') && !respUrl.includes('avatar') && !respUrl.includes('icon')) {
        try {
          const buf = await response.body();
          if (buf.length > 20000) { // Only large images (document pages)
            const b64 = buf.toString('base64');
            capturedImages.push(`data:${ct.split(';')[0]};base64,${b64}`);
          }
        } catch { /* skip */ }
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // ── Wait for Cloudflare ──────────────────────────────────────────────────
    await waitForCloudflare(page, jobId);

    sendProgress(jobId, { status: 'analyzing', message: 'Đang phân tích tài liệu...', percent: 38 });
    await sleep(2000);

    // Get document title
    let docTitle = 'studocu_document';
    try { docTitle = await page.$eval('h1', el => el.textContent.trim()); }
    catch { try { docTitle = await page.title(); } catch {} }
    docTitle = (docTitle || 'studocu_document').substring(0, 60).replace(/[/\\?%*:|"<>]/g, '-').trim();

    await dismissPopups(page);

    // ── Try fast path: extract CDN URLs from __NEXT_DATA__ in page ──────────
    sendProgress(jobId, { status: 'scanning', message: 'Đang quét nội dung tài liệu...', percent: 42 });

    const nextDataImages = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      try {
        const raw = JSON.parse(el.textContent);
        // Search for arrays containing image URLs
        function find(o, d) {
          if (d > 20 || !o || typeof o !== 'object') return null;
          if (Array.isArray(o) && o.length > 0) {
            const f = o[0];
            if (typeof f === 'string' && f.startsWith('http') && (f.includes('cloudfront') || /\.(jpg|png|webp)/i.test(f)))
              return o.filter(x => typeof x === 'string' && x.startsWith('http'));
            if (typeof f === 'object' && f !== null) {
              for (const p of ['image_url','imageUrl','url','src','thumbnail_url','thumbnail']) {
                const urls = o.map(x => x[p]).filter(v => typeof v === 'string' && v.startsWith('http') && (v.includes('cloudfront') || /\.(jpg|png|webp)/i.test(v)));
                if (urls.length > 0) return urls;
              }
            }
            return null;
          }
          for (const k of Object.keys(o)) {
            const r = find(o[k], d + 1);
            if (r) return r;
          }
          return null;
        }
        return find(raw, 0);
      } catch { return null; }
    });

    if (nextDataImages && nextDataImages.length > 0) {
      console.log(`[Job ${jobId}] Playwright: Found ${nextDataImages.length} CDN URLs in __NEXT_DATA__`);
      // Now download CDN images server-side
      await context.close().catch(() => {}); context = null;
      const imageData = await downloadCDNImages(nextDataImages, jobId);
      if (imageData.length > 0) {
        await finalizePDF(jobId, imageData, url, docTitle);
        return;
      }
    }

    // ── Scroll to load all pages & wait for network responses ───────────────
    sendProgress(jobId, { status: 'loading', message: 'Đang tải tất cả các trang...', percent: 50 });
    await autoScroll(page);
    await sleep(3000);

    let pageImages = [...capturedImages]; // From network interceptor

    // ── Screenshot fallback if needed ────────────────────────────────────────
    if (pageImages.length < 2) {
      sendProgress(jobId, { status: 'capturing', message: 'Đang chụp ảnh các trang...', percent: 55 });
      pageImages = await screenshotPages(page, jobId);
    }

    if (pageImages.length === 0)
      throw new Error('Không thể lấy nội dung tài liệu. Tài liệu có thể yêu cầu đăng nhập hoặc không tồn tại.');

    await finalizePDF(jobId, pageImages, url, docTitle);

  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ─── Wait for Cloudflare ───────────────────────────────────────────────────────
async function waitForCloudflare(page, jobId) {
  const isCF = async () => {
    try {
      return await page.evaluate(() => {
        const t = document.title || '';
        const b = document.body?.innerText || '';
        return t.includes('Just a moment') || t.includes('Verifying') ||
               b.includes('Verifying you are human') || b.includes('DDoS protection by Cloudflare') ||
               !!document.querySelector('#cf-spinner, [id*="challenge"], .cf-browser-verification');
      });
    } catch { return false; }
  };

  if (!(await isCF())) return; // No CF challenge

  sendProgress(jobId, { status: 'cloudflare', message: '🛡️ Đang vượt qua bảo mật Cloudflare (có thể mất 10-30s)...', percent: 30 });
  console.log(`[Job ${jobId}] Cloudflare detected, waiting...`);

  const start = Date.now();
  const maxWait = 40_000;
  while (Date.now() - start < maxWait) {
    await sleep(1500);
    if (!(await isCF())) {
      console.log(`[Job ${jobId}] Cloudflare resolved in ${Date.now() - start}ms`);
      await sleep(800);
      return;
    }
  }
  throw new Error('Cloudflare không tự động resolve. Hãy thử lại, hoặc mở studocu.com trong trình duyệt thường trước.');
}

// ─── Dismiss Popups ────────────────────────────────────────────────────────────
async function dismissPopups(page) {
  const sels = [
    '#onetrust-accept-btn-handler', '.cookie-accept', '[aria-label="Close"]',
    '[data-testid="close-button"]', 'button[class*="close"]', 'button[class*="dismiss"]',
    'button[class*="CloseButton"]', '[data-dismiss="modal"]',
  ];
  for (const sel of sels) {
    try { const el = await page.$(sel); if (el) { await el.click(); await sleep(300); } }
    catch { /* ignore */ }
  }
}

// ─── Auto Scroll ───────────────────────────────────────────────────────────────
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let total = 0;
      const dist = 600;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        total += dist;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 100);
    });
  });
}

// ─── Screenshot Pages ──────────────────────────────────────────────────────────
async function screenshotPages(page, jobId) {
  const shots = [];

  // Try specific page selectors first
  const selectors = [
    '[class*="PageRenderer"]', '[class*="DocumentPage"]', '[class*="document-page"]',
    '[class*="page-wrap"]', '[data-page-number]', '[data-page]',
    '.page', '[class*="viewer"] [class*="page"]',
  ];

  let pageEls = [];
  for (const sel of selectors) {
    pageEls = await page.$$(sel);
    if (pageEls.length > 1) break;
  }

  if (pageEls.length > 1) {
    const total = Math.min(pageEls.length, 100);
    for (let i = 0; i < total; i++) {
      sendProgress(jobId, {
        status: 'capturing',
        message: `Chụp trang ${i + 1}/${total}...`,
        percent: 55 + Math.floor((i / total) * 25)
      });
      try {
        await pageEls[i].scrollIntoViewIfNeeded();
        await sleep(500);
        const buf = await pageEls[i].screenshot({ type: 'png' });
        shots.push(`data:image/png;base64,${buf.toString('base64')}`);
      } catch { /* skip */ }
    }
    return shots;
  }

  // Fallback: scroll + screenshot each viewport
  const totalH = await page.evaluate(() => document.body.scrollHeight);
  const vpH = 900;
  const numCaptures = Math.min(Math.ceil(totalH / vpH), 60);
  for (let i = 0; i < numCaptures; i++) {
    sendProgress(jobId, {
      status: 'capturing',
      message: `Chụp màn hình ${i + 1}/${numCaptures}...`,
      percent: 55 + Math.floor((i / numCaptures) * 25)
    });
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), i * vpH);
    await sleep(600);
    const buf = await page.screenshot({ type: 'png' });
    shots.push(`data:image/png;base64,${buf.toString('base64')}`);
  }
  return shots;
}

// ─── Finalize: Build PDF + Send Done ──────────────────────────────────────────
async function finalizePDF(jobId, imageDataList, url, docTitle) {
  sendProgress(jobId, { status: 'generating', message: `Đang tạo PDF từ ${imageDataList.length} trang...`, percent: 82 });

  const pdfBytes = await buildPDF(imageDataList);

  // Extract doc title from URL if not set
  if (!docTitle || docTitle === 'studocu_document') {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      docTitle = parts[parts.length - 2] || parts[parts.length - 1] || 'studocu_document';
      docTitle = docTitle.replace(/-/g, ' ').replace(/[^a-zA-Z0-9\s]/g, '').trim().substring(0, 50);
    } catch {}
  }

  const filename = `${docTitle || 'studocu'}_${jobId.slice(0, 8)}.pdf`;
  const outputPath = path.join(DOWNLOADS_DIR, filename);
  await fse.writeFile(outputPath, pdfBytes);

  sendProgress(jobId, {
    status: 'done',
    message: `✅ Hoàn thành! ${imageDataList.length} trang`,
    percent: 100,
    filename,
    pages: imageDataList.length,
    docTitle: docTitle || 'Studocu Document'
  });

  setTimeout(() => fse.remove(outputPath).catch(() => {}), 10 * 60 * 1000);
  setTimeout(() => delete jobStates[jobId], 15 * 60 * 1000);
}

// ─── Build PDF ─────────────────────────────────────────────────────────────────
async function buildPDF(imageDataUrls) {
  const pdfDoc = await PDFDocument.create();
  for (const dataUrl of imageDataUrls) {
    try {
      const b64 = dataUrl.split(',')[1];
      const bytes = Buffer.from(b64, 'base64');
      let image;
      if (dataUrl.startsWith('data:image/png')) image = await pdfDoc.embedPng(bytes);
      else image = await pdfDoc.embedJpg(bytes);
      const { width, height } = image.scale(1);
      const scale = Math.min(595 / width, 842 / height);
      const w = width * scale, h = height * scale;
      const pg = pdfDoc.addPage([w, h]);
      pg.drawImage(image, { x: 0, y: 0, width: w, height: h });
    } catch (e) { console.warn('Skip page:', e.message); }
  }
  return pdfDoc.save();
}

// ─── Utility ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Auto-cleanup ──────────────────────────────────────────────────────────────
setInterval(async () => {
  try {
    const files = await fse.readdir(DOWNLOADS_DIR);
    const now = Date.now();
    for (const f of files) {
      const fp = path.join(DOWNLOADS_DIR, f);
      const { mtimeMs } = await fse.stat(fp);
      if (now - mtimeMs > 15 * 60 * 1000) fse.remove(fp).catch(() => {});
    }
  } catch {}
}, 30 * 60 * 1000);

// ─── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 STool v2 – Studocu Downloader → http://localhost:${PORT}`);
  console.log(`📁 Profile: ${PROFILE_DIR} (lưu CF cookies giữa các phiên)`);
  console.log(`📌 Strategy A: Direct HTTP | Strategy B: Playwright Chromium\n`);
});
