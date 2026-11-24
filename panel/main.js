/* Agentix Arena Hub — panel logic.
   Drop: clipboard / link / file -> ~/Arena Hub/Drops -> "Arena Drops" bin (+ playhead).
   Templates: every .mogrt on this Mac (Premiere's own + Adobe library + ~/Arena Hub/Templates).
   Motion / Effects: catalog recipes applied to the selected clips. Text: live-previewed caption styles (.mogrt). */
(function () {
  'use strict';
  var nodeReq = (typeof cep_node !== 'undefined' && cep_node.require) ? cep_node.require : (typeof require !== 'undefined' ? require : null);
  var fs = nodeReq('fs'), path = nodeReq('path'), os = nodeReq('os'), cp = nodeReq('child_process'), https = nodeReq('https'), http = nodeReq('http'), crypto = nodeReq('crypto');
  var EXT_DIR = decodeURI(window.location.pathname).replace(/\/index\.html$/, '');
  var HOME = path.join(os.homedir(), 'Arena Hub');
  var DROPS = path.join(HOME, 'Drops'), MY_TPL = path.join(HOME, 'Templates'), MY_TEXT = path.join(HOME, 'Text'), CACHE = path.join(HOME, 'cache');
  var REPO = 'agentixclaude/agentix-arena-hub';
  var VERSION_URL = 'https://raw.githubusercontent.com/' + REPO + '/main/panel/version.json';
  var ZIP_URL = 'https://codeload.github.com/' + REPO + '/zip/refs/heads/main';
  var BIN_PATH = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'), '/usr/bin', '/bin'];
  [DROPS, MY_TPL, MY_TEXT, CACHE].forEach(function (d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });

  var $ = function (id) { return document.getElementById(id); };
  var q = function (s) { return JSON.stringify(String(s)); };
  function evalJsx(script) { return new Promise(function (resolve) { window.__adobe_cep__.evalScript(script, function (r) { resolve(r); }); }); }
  async function jsx(script) { var r = await evalJsx(script); try { return JSON.parse(r); } catch (e) { return { error: r && r !== 'EvalScript error.' ? r : 'Premiere did not answer. Reopen the panel.' }; } }
  function setStatus(id, text, tone) { var el = $(id); el.textContent = text || ''; el.className = 'status' + (tone ? ' tone-' + tone : ''); }
  function store(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k, d) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function which(name) { for (var i = 0; i < BIN_PATH.length; i++) { var p = path.join(BIN_PATH[i], name); if (fs.existsSync(p)) return p; } return null; }
  function fileUrl(p) { return 'file://' + encodeURI(p).replace(/#/g, '%23'); }
  function readJson(rel) { try { return JSON.parse(fs.readFileSync(path.join(EXT_DIR, rel), 'utf8')); } catch (e) { return {}; } }
  function run(file, args, opts) {
    return new Promise(function (resolve) {
      cp.execFile(file, args, Object.assign({ maxBuffer: 64 * 1024 * 1024, env: Object.assign({}, process.env, { PATH: BIN_PATH.join(':') }) }, opts || {}),
        function (err, stdout, stderr) { resolve({ err: err, out: stdout, errText: String(stderr || '') }); });
    });
  }

  var info = { open: false, selected: 0 };
  var busy = false;

  // ---------------- header ----------------
  async function refresh() {
    var r = await jsx('ahInfo()');
    info = r && !r.error ? r : { open: false, selected: 0 };
    $('where').textContent = info.open ? (info.sequence ? info.project.replace(/\.prproj$/i, '') + '  ·  ' + info.sequence : info.project.replace(/\.prproj$/i, '') + '  ·  no sequence open') : 'No project open';
    var chip = $('selchip');
    chip.hidden = !info.open || !info.sequence;
    chip.textContent = (info.selected || 0) + ' selected';
    chip.className = 'chip' + (info.selected ? ' accent' : '');
    paintMotionButton(); paintFxButton();
  }
  $('refresh').addEventListener('click', refresh);

  // ---------------- tabs ----------------
  var tabsSeen = {};
  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('main.tab'), function (m) { m.hidden = m.id !== 'tab-' + name; });
    if (!tabsSeen[name]) { tabsSeen[name] = true; if (name === 'templates') scanTemplates(); if (name === 'motion') renderMotion(); if (name === 'text') renderText(); if (name === 'effects') renderFx(); }
    store('ah:tab', name);
    refresh();
  }
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); }); });
  function segValue(id, cb) {
    Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('#' + id + ' button'), function (x) { x.classList.toggle('on', x === b); });
        cb(b.getAttribute('data-v'));
      });
    });
  }

  // ================= DROP =================
  var drops = load('ah:drops', []);
  function dayDir() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; var dir = path.join(DROPS, d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())); fs.mkdirSync(dir, { recursive: true }); return dir; }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  function uniq(dir, base, ext) { var f = path.join(dir, base + ext), n = 2; while (fs.existsSync(f)) { f = path.join(dir, base + '-' + n++ + ext); } return f; }
  function safeName(s) { return String(s).replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'drop'; }
  var IMG_EXT = /\.(png|jpe?g|gif|tiff?|bmp|psd|ai|svg|webp|avif|heic)$/i;
  var MEDIA_EXT = /\.(png|jpe?g|gif|tiff?|bmp|psd|ai|svg|webp|avif|heic|mp4|mov|m4v|mxf|webm|mkv|avi|wav|mp3|m4a|aif+|mogrt)$/i;

  function renderDrops() {
    var box = $('drops');
    $('dropcount').textContent = drops.length ? drops.length + ' this session and before' : '';
    if (!drops.length) { box.innerHTML = '<div class="empty">Nothing dropped yet.<br>Copy an image or a link anywhere, then press Paste.</div>'; return; }
    box.innerHTML = drops.map(function (d, i) {
      var th = IMG_EXT.test(d.path) && fs.existsSync(d.path) ? ' style="background-image:url(\'' + fileUrl(d.path) + '\')"' : '';
      return '<div class="item"><div class="th"' + th + '></div><div><div class="n" title="' + esc(d.path) + '">' + esc(path.basename(d.path)) + '</div><div class="s">' + esc(d.src) + '</div></div>' +
        '<button data-i="' + i + '">Place</button></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { var d = drops[+b.getAttribute('data-i')]; if (d) bring(d.path, d.src, true); });
    });
  }
  function remember(p, src) {
    drops = drops.filter(function (d) { return d.path !== p; });
    drops.unshift({ path: p, src: src });
    drops = drops.slice(0, 30); store('ah:drops', drops); renderDrops();
  }

  async function toImportable(p) {
    // Premiere can't read webp / avif / heic: convert to PNG next to the original.
    if (!/\.(webp|avif|heic)$/i.test(p)) return p;
    var out = p.replace(/\.[^.]+$/, '.png');
    var ff = which('ffmpeg');
    var r = ff ? await run(ff, ['-y', '-loglevel', 'error', '-i', p, '-frames:v', '1', out]) : { err: true };
    if (r.err && /\.heic$/i.test(p)) r = await run('/usr/bin/sips', ['-s', 'format', 'png', p, '--out', out]);
    if (r.err || !fs.existsSync(out)) throw new Error('could not convert ' + path.extname(p) + ' to PNG (needs ffmpeg)');
    return out;
  }
  async function bring(p, src, forcePlace) {
    var place = forcePlace || $('place').checked;
    var r = await jsx('ahImport(' + q(p) + ',' + (place ? 'true' : 'false') + ')');
    if (r.error) { setStatus('dropstatus', r.error, 'bad'); return false; }
    remember(p, src);
    setStatus('dropstatus', path.basename(p) + ' → Arena Drops' + (r.placed ? ', placed on ' + r.placed : '') + (r.note ? '. ' + r.note : ''), r.note ? 'warn' : 'ok');
    refresh();
    return true;
  }
  async function guard(fn) {
    if (busy) return;
    busy = true; $('dropzone').classList.add('busy'); $('paste').disabled = true; $('urlgo').disabled = true;
    try { await fn(); } catch (e) { setStatus('dropstatus', e.message || String(e), 'bad'); }
    busy = false; $('dropzone').classList.remove('busy'); $('paste').disabled = false; $('urlgo').disabled = false;
  }

  // clipboard via macOS (works even when Premiere keeps ⌘V for itself)
  async function pasteFromClipboard() {
    setStatus('dropstatus', 'Reading the clipboard…');
    var out = uniq(dayDir(), 'paste-' + stamp(), '.png');
    var png = await run('/usr/bin/osascript', ['-e', 'set d to (the clipboard as «class PNGf»)', '-e', 'set f to open for access (POSIX file ' + JSON.stringify(out) + ') with write permission',
      '-e', 'set eof f to 0', '-e', 'write d to f', '-e', 'close access f']);
    if (!png.err && fs.existsSync(out) && fs.statSync(out).size > 0) return bring(out, 'Clipboard image');
    try { fs.unlinkSync(out); } catch (e) {}
    var furl = await run('/usr/bin/osascript', ['-e', 'POSIX path of (the clipboard as «class furl»)']);
    var fp = String(furl.out || '').trim();
    if (!furl.err && fp && fs.existsSync(fp)) return bringLocal(fp, 'Copied file');
    var txt = String((await run('/usr/bin/pbpaste', [])).out || '').trim();
    if (/^https?:\/\//i.test(txt)) { $('url').value = txt; return fromUrl(txt); }
    if (txt && fs.existsSync(txt)) return bringLocal(txt, 'Copied path');
    setStatus('dropstatus', 'The clipboard has no image, file or link.', 'warn');
  }
  async function bringLocal(fp, src) {
    if (fs.statSync(fp).isDirectory()) { setStatus('dropstatus', 'That is a folder. Drop the files inside it.', 'warn'); return; }
    if (!MEDIA_EXT.test(fp)) { setStatus('dropstatus', path.basename(fp) + ' is not a media file Premiere can use.', 'warn'); return; }
    if (/\.mogrt$/i.test(fp)) { var m = await jsx('ahMogrt(' + q(fp) + ',"")'); setStatus('dropstatus', m.error || 'Template added on ' + m.track, m.error ? 'bad' : 'ok'); return; }
    return bring(await toImportable(fp), src);
  }

  // links
  var VIDEO_SITES = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|loom\.com|reddit\.com|threads\.net|linkedin\.com|dailymotion\.com)$/i;
  var CT_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/tiff': '.tif',
    'image/heic': '.heic', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/mp4': '.m4a' };
  function fetchUrl(url, hops) {
    return new Promise(function (resolve, reject) {
      var lib = /^https:/i.test(url) ? https : http;
      var req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': '*/*' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 6) { res.resume(); return resolve(fetchUrl(new URL(res.headers.location, url).href, (hops || 0) + 1)); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('the site answered ' + res.statusCode)); }
        var chunks = [], size = 0;
        res.on('data', function (d) { size += d.length; if (size > 1.5e9) { req.destroy(); reject(new Error('file is over 1.5 GB')); } chunks.push(d); });
        res.on('end', function () { resolve({ url: url, type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), body: Buffer.concat(chunks), disp: String(res.headers['content-disposition'] || '') }); });
      });
      req.on('error', reject);
      req.setTimeout(30000, function () { req.destroy(new Error('the site did not answer in 30 s')); });
    });
  }
  function nameFrom(url, disp) {
    var m = disp.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
    var n = m ? decodeURIComponent(m[1]) : decodeURIComponent((new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]*$/, ''));
    return safeName(n || new URL(url).hostname.replace(/^www\./, ''));
  }
  async function ytdlp(url) {
    var y = which('yt-dlp');
    if (!y) throw new Error('This is a video page. Install yt-dlp (brew install yt-dlp) so Arena Hub can download it.');
    setStatus('dropstatus', 'Downloading with yt-dlp… (long videos take a while)');
    var r = await run(y, ['-f', 'bv*[ext=mp4][vcodec^=avc]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4', '--no-playlist', '--restrict-filenames',
      '-o', path.join(dayDir(), '%(title).70s-%(id)s.%(ext)s'), '--print', 'after_move:filepath', url], { timeout: 15 * 60 * 1000 });
    var fp = String(r.out || '').trim().split('\n').pop();
    if (r.err || !fp || !fs.existsSync(fp)) throw new Error('yt-dlp could not get it: ' + (r.errText.split('\n').filter(Boolean).pop() || 'unknown error'));
    return bring(fp, new URL(url).hostname.replace(/^www\./, ''));
  }
  async function fromUrl(url) {
    url = String(url || '').trim();
    if (!/^https?:\/\//i.test(url)) { setStatus('dropstatus', 'Paste a full link starting with http.', 'warn'); return; }
    var host = new URL(url).hostname.replace(/^www\./, '');
    if (VIDEO_SITES.test(host)) return ytdlp(url);
    setStatus('dropstatus', 'Downloading from ' + host + '…');
    var res = await fetchUrl(url);
    if (res.type === 'text/html') {
      // a web page: take its share image / video (og:video beats og:image)
      var html = res.body.toString('utf8');
      var meta = function (prop) { var m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']+)', 'i')) || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i')); return m ? m[1].replace(/&amp;/g, '&') : null; };
      var media = meta('og:video:secure_url') || meta('og:video') || meta('og:image:secure_url') || meta('og:image') || meta('twitter:image');
      if (!media) return ytdlp(url);      // nothing obvious: let yt-dlp try its 1,800 sites
      res = await fetchUrl(new URL(media, url).href);
    }
    var ext = CT_EXT[res.type] || (path.extname(new URL(res.url).pathname).match(MEDIA_EXT) ? path.extname(new URL(res.url).pathname).toLowerCase() : null);
    if (!ext) throw new Error('That link is not an image or video (' + (res.type || 'unknown type') + ').');
    var fp = uniq(dayDir(), nameFrom(res.url, res.disp), ext);
    fs.writeFileSync(fp, res.body);
    return bring(await toImportable(fp), host);
  }

  $('paste').addEventListener('click', function () { guard(pasteFromClipboard); });
  $('urlgo').addEventListener('click', function () { guard(function () { return fromUrl($('url').value); }); });
  $('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') guard(function () { return fromUrl($('url').value); }); });
  $('dropsdir').addEventListener('click', function () { cp.execFile('/usr/bin/open', [DROPS]); });
  // ⌘V while the panel has focus
  document.addEventListener('paste', function (e) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    var items = e.clipboardData ? e.clipboardData.items : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var file = items[i].getAsFile(); e.preventDefault();
        var fr = new FileReader();
        fr.onload = function () { guard(function () { var out = uniq(dayDir(), 'paste-' + stamp(), '.png'); fs.writeFileSync(out, Buffer.from(fr.result)); return bring(out, 'Clipboard image'); }); };
        fr.readAsArrayBuffer(file); return;
      }
    }
    var t = e.clipboardData && e.clipboardData.getData('text');
    if (t && /^https?:\/\//i.test(t.trim())) { e.preventDefault(); $('url').value = t.trim(); guard(function () { return fromUrl(t); }); return; }
    e.preventDefault(); guard(pasteFromClipboard);
  });
  // drag files in
  var dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('over'); }); });
  document.addEventListener('drop', function (e) {
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).map(function (f) { return f.path; }).filter(Boolean);
    var t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text');
    guard(async function () {
      if (files.length) { for (var i = 0; i < files.length; i++) await bringLocal(files[i], 'Dragged file'); return; }
      if (t && /^https?:\/\//i.test(t.trim())) return fromUrl(t.trim().split('\n')[0]);
      setStatus('dropstatus', 'Nothing usable was dropped.', 'warn');
    });
  });

  // ================= TEMPLATES =================
  var tpl = { all: [], src: 'all', q: '', sel: null };
  function premiereEG() {
    try {
      var apps = fs.readdirSync('/Applications').filter(function (n) { return /^Adobe Premiere Pro 20\d\d$/.test(n); }).sort();
      var out = [];
      apps.reverse().slice(0, 1).forEach(function (n) { var p = path.join('/Applications', n, n + '.app', 'Contents', 'Essential Graphics'); if (fs.existsSync(p)) out.push(p); });
      return out;
    } catch (e) { return []; }
  }
  function walk(dir, depth, acc, source) {
    var names; try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      var p = path.join(dir, n), st; try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory() && depth > 0) walk(p, depth - 1, acc, source);
      else if (/\.mogrt$/i.test(n)) acc.push({ path: p, name: n.replace(/\.mogrt$/i, ''), group: path.basename(dir), source: source, mtime: st.mtimeMs });
    });
  }
  function scanTemplates() {
    var acc = [];
    walk(MY_TPL, 3, acc, 'mine');
    walk(path.join(os.homedir(), 'Library/Application Support/Adobe/Common/Motion Graphics Templates'), 3, acc, 'mine');
    premiereEG().forEach(function (d) { walk(d, 3, acc, 'premiere'); });
    acc.forEach(function (t) { if (t.group === 'Motion Graphics Templates' || t.group === 'Templates') t.group = 'My library'; if (t.group === 'Essential Graphics') t.group = 'Premiere'; });
    tpl.all = acc;
    renderTemplates();
  }
  function thumbFor(t, kind) {
    var key = crypto.createHash('md5').update(t.path + ':' + t.mtime).digest('hex') + (kind === 'mp4' ? '.mp4' : '.png');
    return path.join(CACHE, key);
  }
  async function extractThumb(t, kind) {
    var out = thumbFor(t, kind);
    if (fs.existsSync(out)) return fs.statSync(out).size ? out : null;
    var r = await run('/usr/bin/unzip', ['-p', t.path, 'thumb.' + kind], { encoding: 'buffer' });
    try { fs.writeFileSync(out, r.err ? Buffer.alloc(0) : r.out); } catch (e) {}
    return !r.err && r.out && r.out.length ? out : null;
  }
  function filtered() {
    var qq = tpl.q.toLowerCase();
    return tpl.all.filter(function (t) { return (tpl.src === 'all' || t.source === tpl.src) && (!qq || (t.name + ' ' + t.group).toLowerCase().indexOf(qq) >= 0); })
      .sort(function (a, b) { return a.source === b.source ? (a.group + a.name).localeCompare(b.group + b.name) : (a.source === 'mine' ? -1 : 1); });
  }
  var thumbObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var card = en.target; thumbObserver.unobserve(card);
      var t = tpl.all[+card.getAttribute('data-i')];
      extractThumb(t, 'png').then(function (p) { if (p) card.querySelector('.pv').innerHTML = '<img src="' + fileUrl(p) + '">'; });
    });
  }, { root: null, rootMargin: '200px' });
  function renderTemplates() {
    var list = filtered(), box = $('tpls');
    $('tplcount').textContent = list.length + ' of ' + tpl.all.length;
    $('tplcap').textContent = tpl.src === 'mine' ? 'My templates' : tpl.src === 'premiere' ? 'Premiere templates' : 'Templates';
    if (!list.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">No templates here.<br>Put .mogrt files in ~/Arena Hub/Templates.</div>'; return; }
    box.innerHTML = list.map(function (t) {
      var i = tpl.all.indexOf(t);
      return '<div class="card' + (tpl.sel === t ? ' on' : '') + '" data-i="' + i + '" title="' + esc(t.path) + '"><div class="pv"></div><div class="meta"><span class="n">' + esc(t.name) + '</span><span class="t">' + esc(t.group) + '</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.card'), function (card) {
      thumbObserver.observe(card);
      var t = tpl.all[+card.getAttribute('data-i')];
      card.addEventListener('click', function () { tpl.sel = t; Array.prototype.forEach.call(box.querySelectorAll('.card'), function (c) { c.classList.toggle('on', c === card); }); $('tpladd').disabled = false; $('tpladd').textContent = 'Add “' + t.name + '”'; });
      card.addEventListener('dblclick', function () { tpl.sel = t; addTemplate(); });
      card.addEventListener('mouseenter', function () {
        extractThumb(t, 'mp4').then(function (p) {
          if (!p || !card.matches(':hover')) return;
          var pv = card.querySelector('.pv'); if (pv.querySelector('video')) return;
          var v = document.createElement('video'); v.src = fileUrl(p); v.muted = true; v.loop = true; v.autoplay = true; pv.appendChild(v);
        });
      });
      card.addEventListener('mouseleave', function () { var v = card.querySelector('video'); if (v) v.remove(); });
    });
  }
  async function addTemplate() {
    if (!tpl.sel || busy) return;
    busy = true; $('tpladd').disabled = true; setStatus('tplstatus', 'Adding ' + tpl.sel.name + '…');
    var r = await jsx('ahMogrt(' + q(tpl.sel.path) + ',"")');
    busy = false; $('tpladd').disabled = false;
    setStatus('tplstatus', r.error || tpl.sel.name + ' added at the playhead on ' + r.track + '. Edit its text in Essential Graphics.', r.error ? 'bad' : 'ok');
  }
  $('tplq').addEventListener('input', function () { tpl.q = this.value; renderTemplates(); });
  segValue('tplsrc', function (v) { tpl.src = v; renderTemplates(); });
  $('tpladd').addEventListener('click', addTemplate);
  $('tpldir').addEventListener('click', function () { cp.execFile('/usr/bin/open', [MY_TPL]); });

  // ================= MOTION =================
  var motion = { list: readJson('catalog/motion.json').presets || [], tag: 'all', sel: null };
  function renderMotion() {
    var box = $('motions');
    var list = motion.list.filter(function (m) { return motion.tag === 'all' || m.tag === motion.tag; });
    box.innerHTML = list.map(function (m) {
      return '<div class="card m-' + esc(m.id) + (motion.sel === m ? ' on' : '') + '" data-id="' + esc(m.id) + '"><div class="pv"><div class="mframe"><div class="mclip"></div></div></div>' +
        '<div class="meta"><span class="n">' + esc(m.name) + '</span><span class="t">' + esc(m.tag) + '</span></div><div class="d">' + esc(m.desc) + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.card'), function (card) {
      card.addEventListener('click', function () {
        motion.sel = motion.list.filter(function (m) { return m.id === card.getAttribute('data-id'); })[0];
        Array.prototype.forEach.call(box.querySelectorAll('.card'), function (c) { c.classList.toggle('on', c === card); });
        paintMotionButton();
      });
      card.addEventListener('dblclick', applyMotion);
    });
  }
  function paintMotionButton() {
    var b = $('mapply'); if (!b) return;
    if (!motion.sel) { b.disabled = true; b.textContent = 'Select a preset'; return; }
    b.disabled = busy || !info.selected;
    b.textContent = info.selected ? 'Apply ' + motion.sel.name + ' to ' + info.selected + ' clip' + (info.selected > 1 ? 's' : '') : 'Select clips in the timeline';
  }
  async function applyMotion() {
    await refresh();
    if (!motion.sel || busy) return;
    if (!info.selected) { setStatus('mstatus', 'Select one or more clips in the timeline first.', 'warn'); return; }
    busy = true; paintMotionButton();
    var r = await jsx('ahMotion(' + q(JSON.stringify(motion.sel)) + ')');
    busy = false;
    if (r.error) setStatus('mstatus', r.error, 'bad');
    else setStatus('mstatus', motion.sel.name + ' on ' + r.clips + ' clip' + (r.clips === 1 ? '' : 's') + (r.missing.length ? '. Skipped: ' + r.missing.join(', ') : '. Play it back.'), r.missing.length ? 'warn' : 'ok');
    paintMotionButton();
  }
  segValue('mtag', function (v) { motion.tag = v; renderMotion(); });
  $('mapply').addEventListener('click', applyMotion);

  // ================= TEXT =================
  var text = { list: readJson('catalog/text.json').styles || [], sel: null };
  function words(line) { return line.trim().split(/\s+/).filter(Boolean).map(function (w, i) { return '<span class="w" style="--i:' + i + '">' + esc(w) + '</span>'; }).join(''); }
  function renderText() {
    var line = $('tline').value || 'Your line here';
    $('tstyles').innerHTML = text.list.map(function (s) {
      var has = fs.existsSync(path.join(MY_TEXT, s.file));
      var inner = s.id === 'mask' ? '<span class="clipline"><span class="line">' + esc(line) + '</span></span>' : s.id === 'type' ? '<span class="line">' + esc(line) + '</span>' : '<span class="line">' + words(line) + '</span>';
      return '<div class="tcard' + (text.sel === s ? ' on' : '') + '" data-id="' + esc(s.id) + '"><div class="tstage s-' + esc(s.id) + '">' + inner + '</div>' +
        '<div class="tmeta"><div><div class="n">' + esc(s.name) + '</div><div class="d">' + esc(s.desc) + '</div></div><span class="chip' + (has ? ' ok' : ' warn') + '">' + (has ? 'Ready' : 'Preview') + '</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#tstyles .tcard'), function (card) {
      card.addEventListener('click', function () {
        text.sel = text.list.filter(function (s) { return s.id === card.getAttribute('data-id'); })[0];
        Array.prototype.forEach.call(document.querySelectorAll('#tstyles .tcard'), function (c) { c.classList.toggle('on', c === card); });
        paintText();
      });
    });
    paintText();
  }
  function paintText() {
    var b = $('tadd');
    if (!text.sel) { b.disabled = true; b.textContent = 'Select a style'; setStatus('tstatus', ''); return; }
    var has = fs.existsSync(path.join(MY_TEXT, text.sel.file));
    b.disabled = !has || busy;
    b.textContent = has ? 'Add “' + text.sel.name + '” at playhead' : 'Style file not built yet';
    setStatus('tstatus', has ? '' : 'Preview only. Drop “' + text.sel.file + '” into ~/Arena Hub/Text to enable it.', has ? '' : 'warn');
  }
  var tlineTimer;
  $('tline').addEventListener('input', function () { clearTimeout(tlineTimer); tlineTimer = setTimeout(renderText, 250); });
  $('tadd').addEventListener('click', async function () {
    if (!text.sel || busy) return;
    busy = true; paintText();
    var r = await jsx('ahMogrt(' + q(path.join(MY_TEXT, text.sel.file)) + ',' + q($('tline').value) + ')');
    busy = false; paintText();
    setStatus('tstatus', r.error || text.sel.name + ' added on ' + r.track + (r.text ? ' with your line.' : '. Type your line in Essential Graphics.'), r.error ? 'bad' : 'ok');
  });
  $('tdir').addEventListener('click', function () { cp.execFile('/usr/bin/open', [MY_TEXT]); });

  // ================= EFFECTS =================
  var fx = { list: readJson('catalog/effects.json').recipes || [], sel: null };
  function renderFx() {
    $('fx').innerHTML = fx.list.map(function (r) {
      return '<div class="fxrow' + (fx.sel === r ? ' on' : '') + '" data-id="' + esc(r.id) + '"><span class="n">' + esc(r.name) + '</span><span class="chip">' + esc(r.tag) + '</span><span class="d">' + esc(r.desc) + '  ·  ' + esc(r.effect) + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#fx .fxrow'), function (row) {
      row.addEventListener('click', function () {
        fx.sel = fx.list.filter(function (r) { return r.id === row.getAttribute('data-id'); })[0];
        Array.prototype.forEach.call(document.querySelectorAll('#fx .fxrow'), function (x) { x.classList.toggle('on', x === row); });
        paintFxButton();
      });
      row.addEventListener('dblclick', applyFx);
    });
  }
  function paintFxButton() {
    var b = $('fxapply'); if (!b) return;
    if (!fx.sel) { b.disabled = true; b.textContent = 'Select a recipe'; return; }
    b.disabled = busy || !info.selected;
    b.textContent = info.selected ? 'Apply ' + fx.sel.name + ' to ' + info.selected + ' clip' + (info.selected > 1 ? 's' : '') : 'Select clips in the timeline';
  }
  async function applyFx() {
    await refresh();
    if (!fx.sel || busy) return;
    if (!info.selected) { setStatus('fxstatus', 'Select one or more clips in the timeline first.', 'warn'); return; }
    busy = true; paintFxButton();
    var r = await jsx('ahEffect(' + q(JSON.stringify(fx.sel)) + ')');
    busy = false;
    if (r.error) setStatus('fxstatus', r.error, 'bad');
    else setStatus('fxstatus', fx.sel.name + ' on ' + r.clips + ' clip' + (r.clips === 1 ? '' : 's') + (r.missing.length ? '. Not set: ' + r.missing.join(', ') : '.'), r.missing.length ? 'warn' : 'ok');
    paintFxButton();
  }
  $('fxapply').addEventListener('click', applyFx);

  // ---------------- self-update (GitHub) ----------------
  function localVersion() { try { return JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'version.json'), 'utf8')).version; } catch (e) { return '0.0.0'; } }
  function newer(a, b) { var x = String(a).split('.'), y = String(b).split('.'); for (var i = 0; i < 3; i++) { var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0); if (d) return d > 0; } return false; }
  function download(url, cb, hops) {
    https.get(url, { headers: { 'User-Agent': 'agentix-arena-hub', 'Cache-Control': 'no-cache' } }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 5) { res.resume(); return download(res.headers.location, cb, (hops || 0) + 1); }
      if (res.statusCode !== 200) { res.resume(); return cb(new Error('HTTP ' + res.statusCode)); }
      var chunks = []; res.on('data', function (d) { chunks.push(d); }); res.on('end', function () { cb(null, Buffer.concat(chunks)); });
    }).on('error', cb);
  }
  function checkUpdate() {
    $('ver').textContent = 'v' + localVersion();
    download(VERSION_URL + '?t=' + Date.now(), function (err, buf) {
      if (err) return;
      var remote; try { remote = JSON.parse(buf.toString('utf8')); } catch (e) { return; }
      if (!remote.version || !newer(remote.version, localVersion())) return;
      $('updatetext').textContent = 'Version ' + remote.version + ' is available' + (remote.notes ? ' — ' + remote.notes : '');
      $('update').hidden = false;
    });
  }
  $('updatebtn').addEventListener('click', function () {
    var btn = $('updatebtn'); btn.disabled = true; btn.textContent = 'Updating…';
    var fail = function (msg) { btn.disabled = false; btn.textContent = 'Try again'; $('updatetext').textContent = 'Update failed: ' + msg; };
    download(ZIP_URL, function (err, buf) {
      if (err) return fail(err.message);
      try {
        var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-hub-'));
        var zip = path.join(tmp, 'update.zip'); fs.writeFileSync(zip, buf);
        cp.execFileSync('/usr/bin/unzip', ['-q', '-o', zip, '-d', tmp]);
        var root = fs.readdirSync(tmp).filter(function (n) { return fs.existsSync(path.join(tmp, n, 'panel', 'CSXS', 'manifest.xml')); })[0];
        if (!root) throw new Error('package is incomplete');
        var src = path.join(tmp, root, 'panel');
        if (fs.readFileSync(path.join(src, 'CSXS', 'manifest.xml'), 'utf8').indexOf('com.uai.arenahub') < 0) throw new Error('wrong package');
        cp.execFileSync('/bin/cp', ['-R', src + '/.', EXT_DIR]);
        $('update').className = 'update done'; btn.style.display = 'none';
        $('updatetext').textContent = 'Updated to v' + localVersion() + '. Close and reopen the panel.';
      } catch (e) { fail(e.message); }
    });
  });

  // ---------------- start ----------------
  checkUpdate();
  renderDrops();
  showTab(load('ah:tab', 'drop'));
  var lastFocus = 0;
  window.addEventListener('focus', function () { var t = Date.now(); if (busy || t - lastFocus < 1200) return; lastFocus = t; refresh(); if (tabsSeen.templates && t - (scanTemplates.at || 0) > 60000) { scanTemplates.at = t; scanTemplates(); } });
})();
