(async function () {
  const S = 'http://localhost:3000';

  function toast(html, isError) {
    let t = document.getElementById('stool-bookmarklet-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'stool-bookmarklet-toast';
      t.style.cssText = [
        'position:fixed',
        'top:16px',
        'right:16px',
        'background:' + (isError ? '#3b1119' : 'linear-gradient(135deg,#6366f1,#06b6d4)'),
        'color:#fff',
        'padding:12px 18px',
        'border-radius:12px',
        'z-index:2147483647',
        'font:500 14px system-ui',
        'box-shadow:0 8px 32px rgba(0,0,0,.4)',
        'line-height:1.5',
        'max-width:340px'
      ].join(';');
      document.body.appendChild(t);
    }
    t.innerHTML = html;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.remove(), isError ? 8000 : 3500);
  }

  function clean(value) {
    if (typeof value !== 'string') return '';
    try {
      const url = new URL(value.replace(/&amp;/g, '&').trim().split(/\s+/)[0].replace(/[),;]+$/g, ''));
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function isPageImage(url) {
    return /^https?:\/\//i.test(url) &&
      /(cloudfront|studocu)/i.test(url) &&
      !/\.(js|css|html|svg|json|woff2?)(?:[?#]|$)/i.test(url) &&
      !/logo|icon|avatar|badge|sprite|profile|placeholder|tracking/i.test(url) &&
      (/\.(jpg|jpeg|png|webp)(?:[?#]|$)/i.test(url) || /document|page|pages|preview/i.test(url));
  }

  function dedupeKey(raw) {
    try {
      const url = new URL(raw);
      for (const key of Array.from(url.searchParams.keys())) {
        if (/^(width|height|w|h|quality|q|format|output-format|auto|fit|dpr)$/i.test(key)) {
          url.searchParams.delete(key);
        }
      }
      return url.hostname + url.pathname + '?' + url.searchParams.toString();
    } catch {
      return raw;
    }
  }

  function pageNumber(raw) {
    const patterns = [
      /(?:page|pages|p)[_/-]?(\d{1,4})(?=[^\d]|$)/i,
      /(?:^|[^\d])(\d{1,4})\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/i
    ];
    for (const pattern of patterns) {
      const match = raw.match(pattern);
      const n = match && Number(match[1]);
      if (Number.isInteger(n) && n > 0 && n <= 1000) return n;
    }
    return 0;
  }

  function normalize(urls, pageCount) {
    const out = [];
    const seen = new Set();
    for (const raw of urls || []) {
      const url = clean(raw);
      if (!isPageImage(url)) continue;
      const key = dedupeKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url);
    }
    out.sort((a, b) => {
      const pa = pageNumber(a);
      const pb = pageNumber(b);
      return pa && pb ? pa - pb : 0;
    });
    return pageCount && out.length > pageCount ? out.slice(0, pageCount) : out;
  }

  function findPageCount(obj, depth) {
    if (depth > 12 || !obj || typeof obj !== 'object') return 0;
    for (const key of Object.keys(obj)) {
      const n = Number(obj[key]);
      if (/^(pageCount|pagesCount|numberOfPages|numPages|totalPages|total_pages)$/i.test(key) &&
          Number.isInteger(n) && n > 0 && n <= 1000) {
        return n;
      }
    }
    for (const key of Object.keys(obj)) {
      const found = findPageCount(obj[key], depth + 1);
      if (found) return found;
    }
    return 0;
  }

  function collectJsonCandidates(obj, candidates, depth) {
    if (depth > 20 || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
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
      const cleanUrls = normalize(urls);
      if (cleanUrls.length > 1) candidates.push(cleanUrls);
    }
    for (const key of Object.keys(obj)) collectJsonCandidates(obj[key], candidates, depth + 1);
  }

  function score(urls, pageCount) {
    let value = urls.length * 10;
    if (pageCount) value -= Math.abs(urls.length - pageCount) * 8;
    for (const url of urls) {
      if (/\.(jpg|jpeg|png|webp)(?:[?#]|$)/i.test(url)) value += 10;
      if (/document|page|preview|pages/i.test(url)) value += 8;
      if (/thumb|thumbnail|small/i.test(url)) value -= 20;
    }
    return value;
  }

  try {
    const importWindow = window.open(S + '/import.html', 'stool_import');
    toast('<b>STool</b><br>Dang quet trang tai lieu...');

    let pageCount = 0;
    let jsonUrls = [];
    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
      try {
        const data = JSON.parse(nextData.textContent);
        pageCount = findPageCount(data, 0);
        const candidates = [];
        collectJsonCandidates(data, candidates, 0);
        candidates.sort((a, b) => score(b, pageCount) - score(a, pageCount));
        jsonUrls = candidates[0] || [];
      } catch {}
    }

    if (!pageCount) {
      const matches = Array.from((document.body.innerText || '').matchAll(/(\d{1,4})\s*(?:pages?|trang)\b/gi))
        .map(match => Number(match[1]))
        .filter(n => n > 0 && n <= 1000);
      pageCount = matches.length ? Math.max(...matches) : 0;
    }

    const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += 900) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 140));
    }
    window.scrollTo(0, 0);
    await new Promise(resolve => setTimeout(resolve, 500));

    const domUrls = [];
    for (const img of Array.from(document.querySelectorAll('img'))) {
      const rect = img.getBoundingClientRect();
      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;
      const src = img.currentSrc || img.src || img.dataset.src || img.getAttribute('data-src') || '';
      if (img.closest('header,footer,nav,aside,[role="navigation"]')) continue;
      if (!((rect.width > 240 && rect.height > 320) ||
            (naturalWidth > 600 && naturalHeight > 700) ||
            /document|page|preview/i.test(src))) continue;
      domUrls.push(src);
      if (img.srcset) {
        for (const part of img.srcset.split(',')) domUrls.push(part.trim().split(' ')[0]);
      }
    }

    let urls = normalize(domUrls, pageCount);
    if (urls.length < 2) urls = normalize(jsonUrls, pageCount);

    if (urls.length === 0) {
      toast('<b>STool</b><br>Khong tim thay anh trang tai lieu. Hay cuon trang Studocu cho load het roi bam lai.', true);
      return;
    }

    const title = document.querySelector('h1')?.textContent?.trim() || document.title || 'studocu_document';
    toast('<b>STool</b><br>Tim thay ' + urls.length + (pageCount ? '/' + pageCount : '') + ' trang - dang gui...');

    const msg = { type: 'STOOL_IMPORT', urls, title, sourceUrl: location.href, pageCount: pageCount || null };
    const send = () => {
      if (importWindow && !importWindow.closed) importWindow.postMessage(msg, S);
    };
    send();
    setTimeout(send, 800);
    setTimeout(send, 2000);
    setTimeout(send, 4000);
  } catch (error) {
    toast('<b>STool loi</b><br>' + (error && error.message ? error.message : String(error)), true);
  }
})();
