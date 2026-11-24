/* Agentix Arena Hub — panel logic.
   Drop: clipboard / file / folder / any link -> <project>/Assets/Drops -> "Arena Drops" bin (+ playhead).
   Templates: the team's picks from the Adobe template library.
   Motion / Effects: catalog recipes on the selected clips. Text: editable one-line captions (Graphics clips or a caption track), nothing rendered. */
(function () {
  'use strict';
  var nodeReq = (typeof cep_node !== 'undefined' && cep_node.require) ? cep_node.require : (typeof require !== 'undefined' ? require : null);
  var fs = nodeReq('fs'), path = nodeReq('path'), os = nodeReq('os'), cp = nodeReq('child_process'), https = nodeReq('https'), http = nodeReq('http'), crypto = nodeReq('crypto');
  var EXT_DIR = decodeURI(window.location.pathname).replace(/\/index\.html$/, '');
  var HOME = path.join(os.homedir(), 'Arena Hub');
  var CACHE = path.join(HOME, 'cache');
  var REPO = 'agentixclaude/agentix-arena-hub';
  var VERSION_URL = 'https://raw.githubusercontent.com/' + REPO + '/main/panel/version.json';
  var ZIP_URL = 'https://codeload.github.com/' + REPO + '/zip/refs/heads/main';
  var BIN_PATH = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin'), '/usr/bin', '/bin'];
  [CACHE].forEach(function (d) { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });

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
    paintMotionButton(); paintFxButton(); paintDropTo();
  }
  $('refresh').addEventListener('click', refresh);

  // ---------------- tabs ----------------
  var tabsSeen = {};
  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('main.tab'), function (m) { m.hidden = m.id !== 'tab-' + name; });
    if (!tabsSeen[name]) { tabsSeen[name] = true; if (name === 'templates') scanTemplates(); if (name === 'motion') renderMotion(); if (name === 'text') renderText(); if (name === 'effects') renderFx(); if (name === 'tools') renderTools(); }
    if (name === 'tools' && tabsSeen.tools) rangeInfo();
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
  // Files land next to the project: <project folder>/Assets/Drops (no project open -> ~/Arena Hub/Drops).
  var drops = load('ah:drops', []);
  function projectDir() { return info.open && info.path ? path.dirname(info.path) : null; }
  function assetDir(kind) {
    var base = projectDir(), dir = base ? path.join(base, 'Assets', kind) : path.join(HOME, kind);
    fs.mkdirSync(dir, { recursive: true }); return dir;
  }
  function paintDropTo() {
    var base = projectDir();
    $('dropto').textContent = base ? 'Saves to ' + path.basename(base) + ' / Assets / Drops' : 'No project open: saves to ~/Arena Hub/Drops';
  }
  function stamp() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); }
  function uniq(dir, base, ext) { var f = path.join(dir, base + ext), n = 2; while (fs.existsSync(f)) { f = path.join(dir, base + '-' + n++ + ext); } return f; }
  function safeName(s) { return String(s).replace(/[\/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'drop'; }
  var IMG_EXT = /\.(png|jpe?g|jfif|gif|tiff?|bmp|psd|ai|eps|svg|webp|avif|heic|heif|tga|exr|dpx)$/i;
  var MEDIA_EXT = /\.(png|jpe?g|jfif|gif|tiff?|bmp|psd|ai|eps|svg|webp|avif|heic|heif|tga|exr|dpx|mp4|mov|m4v|mxf|webm|mkv|avi|wmv|flv|3gp|mts|m2ts|ts|mpg|mpeg|r3d|braw|wav|mp3|m4a|aac|aif+|flac|ogg|opus|mogrt|prproj|aep|srt|vtt)$/i;

  function renderDrops() {
    var box = $('drops');
    $('dropcount').textContent = drops.length ? drops.length : '';
    $('dropclear').hidden = !drops.length;
    if (!drops.length) { box.innerHTML = '<div class="empty">Nothing dropped yet.<br>Copy an image, a file or a link anywhere, then press Paste.</div>'; return; }
    box.innerHTML = drops.map(function (d, i) {
      var th = IMG_EXT.test(d.path) && fs.existsSync(d.path) ? ' style="background-image:url(\'' + fileUrl(d.path) + '\')"' : '';
      return '<div class="item" data-i="' + i + '"><div class="th"' + th + '></div><div><div class="n" title="' + esc(d.path) + '">' + esc(path.basename(d.path)) + '</div><div class="s">' + esc(d.src) + '</div></div>' +
        '<div class="row acts"><button data-a="place">Place</button><button class="x" data-a="x" title="Remove or delete">✕</button></div>' +
        '<div class="ask" hidden><span>Delete this drop?</span><button data-a="list">Remove from list</button><button class="danger" data-a="kill">Delete file + from project</button><button class="link" data-a="no">Cancel</button></div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.item'), function (it) {
      var i = +it.getAttribute('data-i'), d = drops[i];
      it.addEventListener('click', function (e) {
        var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
        if (a === 'place') { if (d && fs.existsSync(d.path)) bring(d.path, d.src, true); else setStatus('dropstatus', 'That file was moved or deleted.', 'warn'); }
        if (a === 'x' || a === 'no') { it.classList.toggle('asking', a === 'x'); it.querySelector('.ask').hidden = a !== 'x'; }
        if (a === 'list') { dropForget(d.path); setStatus('dropstatus', path.basename(d.path) + ' removed from the list. The file and project item stay.', 'ok'); }
        if (a === 'kill') dropDelete(d);
      });
    });
  }
  function dropForget(p) { drops = drops.filter(function (x) { return x.path !== p; }); store('ah:drops', drops); renderDrops(); }
  async function dropDelete(d) {
    if (busy) return;
    busy = true;
    try {
      var r = await jsx('ahDeleteMedia(' + q(d.path) + ')');
      if (r.error) throw new Error('Project: ' + r.error);
      var gone = false; try { if (fs.existsSync(d.path)) { fs.unlinkSync(d.path); } gone = true; } catch (e) { throw new Error('Could not delete the file: ' + e.message); }
      dropForget(d.path);
      setStatus('dropstatus', path.basename(d.path) + ' deleted from disk' + (r.removed ? ' and from the project (' + r.removed + ' item' + (r.removed > 1 ? 's' : '') + ', clips of it in sequences too)' : '') + '. Undo can bring the project item back, not the file.', 'ok');
    } catch (e) { setStatus('dropstatus', e.message, 'bad'); }
    busy = false;
  }
  $('dropclear').addEventListener('click', function () { var n = drops.length; drops = []; store('ah:drops', drops); renderDrops(); setStatus('dropstatus', n + ' drops cleared from the list. Files and project items are kept.', 'ok'); });

  function remember(p, src) {
    drops = drops.filter(function (d) { return d.path !== p; });
    drops.unshift({ path: p, src: src });
    drops = drops.slice(0, 40); store('ah:drops', drops); renderDrops();
  }

  // Make anything Premiere-friendly: odd images -> PNG, web video (VP9 / AV1 / webm / mkv / flv) -> H.264 MP4.
  async function normalize(p) {
    var ff = which('ffmpeg'), out, r;
    if (/\.(jfif)$/i.test(p)) { out = p.replace(/\.jfif$/i, '.jpg'); fs.renameSync(p, out); return out; }
    if (/\.(webp|avif|heic|heif)$/i.test(p)) {
      out = p.replace(/\.[^.]+$/, '.png');
      r = /\.(heic|heif)$/i.test(p) ? await run('/usr/bin/sips', ['-s', 'format', 'png', p, '--out', out]) : (ff ? await run(ff, ['-y', '-loglevel', 'error', '-i', p, '-frames:v', '1', out]) : { err: true });
      if ((r.err || !fs.existsSync(out)) && ff) r = await run(ff, ['-y', '-loglevel', 'error', '-i', p, '-frames:v', '1', out]);
      if (!fs.existsSync(out)) throw new Error('Could not convert ' + path.extname(p) + ' to PNG (needs ffmpeg).');
      return out;
    }
    if (/\.(mp4|mov|m4v|webm|mkv|avi|flv|wmv|3gp|ts|mpg|mpeg)$/i.test(p)) {
      var probe = which('ffprobe'), codec = '';
      if (probe) codec = String((await run(probe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', p])).out || '').trim();
      var bad = /^(vp8|vp9|av1|theora|flv1|wmv\d|msmpeg4v\d|h263)$/i.test(codec) || /\.(webm|mkv|flv|wmv|3gp|avi)$/i.test(p) && !/^(h264|hevc|prores)$/i.test(codec);
      if (!bad || !ff) return p;
      out = uniq(path.dirname(p), path.basename(p).replace(/\.[^.]+$/, ''), '.mp4');
      setStatus('dropstatus', 'Converting ' + (codec || path.extname(p)) + ' to H.264 so Premiere can play it…');
      r = await run(ff, ['-y', '-loglevel', 'error', '-i', p, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out], { timeout: 30 * 60 * 1000 });
      if (r.err || !fs.existsSync(out)) throw new Error('Could not convert the video: ' + (r.errText.split('\n').filter(Boolean).pop() || 'ffmpeg failed'));
      try { fs.renameSync(p, p + '.original'); } catch (e) {}
      return out;
    }
    return p;
  }
  async function bring(p, src, forcePlace) {
    var place = forcePlace || $('place').checked;
    var r = await jsx('ahImport(' + q(p) + ',' + (place ? 'true' : 'false') + ',"Arena Drops")');
    if (r.error) { setStatus('dropstatus', r.error, 'bad'); return false; }
    remember(p, src);
    setStatus('dropstatus', path.basename(p) + ' → Arena Drops' + (r.placed ? ', placed on ' + r.placed : '') + (r.note ? '. ' + r.note : ''), r.note ? 'warn' : 'ok');
    refresh();
    return true;
  }
  async function guard(fn) {
    if (busy) return;
    busy = true; $('dropzone').classList.add('busy'); $('paste').disabled = true; $('urlgo').disabled = true;
    try { await refresh(); await fn(); } catch (e) { setStatus('dropstatus', e.message || String(e), 'bad'); }
    busy = false; $('dropzone').classList.remove('busy'); $('paste').disabled = false; $('urlgo').disabled = false;
  }

  // clipboard via macOS (works even when Premiere keeps ⌘V for itself)
  async function pasteFromClipboard() {
    setStatus('dropstatus', 'Reading the clipboard…');
    var furl = await run('/usr/bin/osascript', ['-e', 'try', '-e', 'return POSIX path of (the clipboard as «class furl»)', '-e', 'end try', '-e', 'return ""']);
    var fp = String(furl.out || '').trim();
    if (fp && fs.existsSync(fp)) return bringLocal(fp, 'Copied file');
    var out = uniq(assetDir('Drops'), 'paste-' + stamp(), '.png');
    var png = await run('/usr/bin/osascript', ['-e', 'set d to (the clipboard as «class PNGf»)', '-e', 'set f to open for access (POSIX file ' + JSON.stringify(out) + ') with write permission',
      '-e', 'set eof f to 0', '-e', 'write d to f', '-e', 'close access f']);
    if (!png.err && fs.existsSync(out) && fs.statSync(out).size > 0) return bring(out, 'Clipboard image');
    try { fs.unlinkSync(out); } catch (e) {}
    var txt = String((await run('/usr/bin/pbpaste', [])).out || '').trim();
    var links = linksIn(txt);
    if (links.length) { $('url').value = links.join(' '); return fromLinks(links); }
    if (txt && fs.existsSync(txt)) return bringLocal(txt, 'Copied path');
    setStatus('dropstatus', 'The clipboard has no image, file or link.', 'warn');
  }
  async function bringLocal(fp, src) {
    if (fs.statSync(fp).isDirectory()) {
      var inside = fs.readdirSync(fp).filter(function (n) { return MEDIA_EXT.test(n) && !/^\./.test(n); }).map(function (n) { return path.join(fp, n); });
      if (!inside.length) { setStatus('dropstatus', 'No media files in that folder.', 'warn'); return; }
      for (var i = 0; i < inside.length; i++) { setStatus('dropstatus', 'Importing ' + (i + 1) + ' of ' + inside.length + '…'); await bringLocal(inside[i], 'Folder ' + path.basename(fp)); }
      return;
    }
    if (!MEDIA_EXT.test(fp)) { setStatus('dropstatus', path.basename(fp) + ' is not a media file Premiere can use.', 'warn'); return; }
    if (/\.mogrt$/i.test(fp)) { var m = await jsx('ahMogrt(' + q(fp) + ',"")'); setStatus('dropstatus', m.error || 'Template added on ' + m.track, m.error ? 'bad' : 'ok'); return; }
    // outside files are copied into Assets/Drops so the project travels with its media
    var dir = assetDir('Drops'), dest = fp;
    if (path.dirname(fp) !== dir && !/\.(prproj|aep)$/i.test(fp)) {
      dest = uniq(dir, path.basename(fp).replace(/\.[^.]+$/, ''), path.extname(fp));
      setStatus('dropstatus', 'Copying ' + path.basename(fp) + ' into Assets / Drops…');
      await new Promise(function (res, rej) { fs.copyFile(fp, dest, function (e) { e ? rej(e) : res(); }); });
    }
    return bring(await normalize(dest), src);
  }

  // ---- links ----
  function linksIn(txt) { return (String(txt || '').match(/https?:\/\/[^\s"'<>]+/gi) || []).map(function (u) { return u.replace(/[),.;]+$/, ''); }); }
  var SOCIAL = /(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|vimeo\.com|x\.com|twitter\.com|facebook\.com|fb\.watch|fb\.com|loom\.com|reddit\.com|redd\.it|threads\.net|linkedin\.com|dailymotion\.com|pinterest\.[a-z.]+|pin\.it|snapchat\.com|twitch\.tv|soundcloud\.com|bilibili\.com|streamable\.com|tumblr\.com|vk\.com|rumble\.com|ok\.ru|imgur\.com|giphy\.com|9gag\.com)$/i;
  var CT_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg', 'image/tiff': '.tif',
    'image/heic': '.heic', 'image/bmp': '.bmp', 'image/vnd.adobe.photoshop': '.psd', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'video/x-msvideo': '.avi',
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav', 'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac', 'audio/ogg': '.ogg' };
  function fetchUrl(url, hops, toFile) {
    return new Promise(function (resolve, reject) {
      var lib = /^https:/i.test(url) ? https : http;
      var req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept': '*/*' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 8) { res.resume(); return resolve(fetchUrl(new URL(res.headers.location, url).href, (hops || 0) + 1, toFile)); }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('The site answered ' + res.statusCode + (res.statusCode === 403 || res.statusCode === 401 ? ' (private or needs a login)' : '') + '.')); }
        var type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), disp = String(res.headers['content-disposition'] || '');
        var total = +res.headers['content-length'] || 0, got = 0, chunks = [], ws = null;
        var isPage = type === 'text/html' || type === 'application/xhtml+xml';
        if (toFile && !isPage) ws = fs.createWriteStream(toFile);
        res.on('data', function (d) {
          got += d.length;
          if (ws) ws.write(d); else chunks.push(d);
          if (total > 4e6) setStatus('dropstatus', 'Downloading… ' + Math.round(got / total * 100) + '%  (' + Math.round(got / 1e6) + ' MB)');
        });
        res.on('end', function () {
          var done = function () { resolve({ url: url, type: type, disp: disp, body: ws ? null : Buffer.concat(chunks), file: ws ? toFile : null }); };
          if (ws) ws.end(done); else done();
        });
      });
      req.on('error', reject);
      req.setTimeout(60000, function () { req.destroy(new Error('The site did not answer in 60 s.')); });
    });
  }
  function nameFrom(url, disp) {
    var m = disp.match(/filename\*=UTF-8''([^;]+)/i) || disp.match(/filename="?([^";]+)/i);
    var n = m ? decodeURIComponent(m[1]).replace(/\.[^.]+$/, '') : decodeURIComponent((new URL(url).pathname.split('/').pop() || '').replace(/\.[^.]*$/, ''));
    return safeName(n || new URL(url).hostname.replace(/^www\./, ''));
  }
  function extFrom(res, disp) {
    var m = disp.match(/filename\*?=(?:UTF-8'')?"?[^";]*?(\.[A-Za-z0-9]{2,5})"?(;|$)/i);
    if (m && MEDIA_EXT.test(m[1])) return m[1].toLowerCase();
    if (CT_EXT[res.type]) return CT_EXT[res.type];
    var pe = path.extname(new URL(res.url).pathname);
    return MEDIA_EXT.test(pe) ? pe.toLowerCase() : null;
  }
  // download straight to Assets/Drops; returns the saved path, or the page HTML when the link is a web page
  async function download(url, srcLabel) {
    var tmp = path.join(assetDir('Drops'), '.arena-' + Date.now() + '.part');
    var res = await fetchUrl(url, 0, tmp);
    if (!res.file) return { html: res.body.toString('utf8'), url: res.url };
    var ext = extFrom(res, res.disp);
    if (!ext) { try { fs.unlinkSync(tmp); } catch (e) {} throw new Error('That link is not a media file (' + (res.type || 'unknown type') + ').'); }
    var fp = uniq(path.dirname(tmp), nameFrom(res.url, res.disp), ext);
    fs.renameSync(tmp, fp);
    return { file: fp };
  }
  function driveId(u) {
    var m = u.match(/\/file\/d\/([\w-]{10,})/) || u.match(/[?&]id=([\w-]{10,})/) || u.match(/\/d\/([\w-]{10,})/);
    return m ? m[1] : null;
  }
  async function ytdlp(url, host) {
    var y = which('yt-dlp');
    if (!y) throw new Error('This is a ' + host + ' link. Install yt-dlp (brew install yt-dlp) so Arena Hub can download it.');
    var dir = assetDir('Drops');
    var args = ['-f', 'bv*[ext=mp4][vcodec^=avc]+ba[ext=m4a]/b[ext=mp4][vcodec^=avc]/bv*+ba/b', '--merge-output-format', 'mp4', '--no-playlist', '--restrict-filenames',
      '--ffmpeg-location', path.dirname(which('ffmpeg') || '/opt/homebrew/bin/ffmpeg'), '-o', path.join(dir, '%(uploader).30s-%(title).60s-%(id)s.%(ext)s'), '--print', 'after_move:filepath', url];
    var tries = [[], ['--cookies-from-browser', 'chrome']];     // second try uses your Chrome login (Instagram, Facebook, private posts)
    var last = '';
    for (var i = 0; i < tries.length; i++) {
      setStatus('dropstatus', (i ? 'Retrying with your Chrome login…' : 'Downloading from ' + host + '…') + ' (long videos take a while)');
      var r = await run(y, tries[i].concat(args), { timeout: 20 * 60 * 1000 });
      var fp = String(r.out || '').trim().split('\n').filter(Boolean).pop();
      if (!r.err && fp && fs.existsSync(fp)) return fp;
      last = (r.errText.split('\n').filter(function (l) { return /ERROR/.test(l); }).pop() || r.errText.split('\n').filter(Boolean).pop() || '').replace(/^ERROR:\s*/, '');
    }
    var e = new Error(last || 'yt-dlp could not download it'); e.ytdlp = true; throw e;
  }
  function ogMedia(html) {
    var meta = function (prop) {
      var m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']+)', 'i')) || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i'));
      return m ? m[1].replace(/&amp;/g, '&') : null;
    };
    return meta('og:video:secure_url') || meta('og:video:url') || meta('og:video') || meta('og:image:secure_url') || meta('og:image') || meta('twitter:image');
  }
  async function fromLink(url) {
    var u = new URL(url), host = u.hostname.replace(/^www\./, ''), got;
    if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(host)) {
      if (/\/folders\//.test(u.pathname)) throw new Error('That is a Drive folder. Share the file links, or download the folder as a zip and drop it here.');
      if (/\/(document|spreadsheets|presentation)\//.test(u.pathname)) throw new Error('That is a Google Doc/Sheet/Slide, not a media file.');
      var id = driveId(url); if (!id) throw new Error('Could not read the Drive file ID from that link.');
      setStatus('dropstatus', 'Downloading from Google Drive…');
      got = await download('https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t');
      if (got.html) throw new Error('Drive would not hand the file over. Set sharing to "Anyone with the link".');
      return bring(await normalize(got.file), 'Google Drive');
    }
    if (/(^|\.)dropbox\.com$/.test(host)) {
      u.searchParams.delete('dl'); u.searchParams.set('dl', '1');
      setStatus('dropstatus', 'Downloading from Dropbox…');
      got = await download(u.href);
      if (got.html) throw new Error('Dropbox returned a page, not a file. Check the link is shared.');
      return bring(await normalize(got.file), 'Dropbox');
    }
    if (/(^|\.)(1drv\.ms|onedrive\.live\.com)$/.test(host)) { u.searchParams.set('download', '1'); url = u.href; }
    if (SOCIAL.test(host)) {
      try { return bring(await normalize(await ytdlp(url, host)), host); }
      catch (e) {
        // photo posts (Instagram / Pinterest / X images) have no video: fall back to the post's share image
        try { var page = await download(url); if (page.file) return bring(await normalize(page.file), host); var m = page.html && ogMedia(page.html); if (m) { var g = await download(new URL(m, url).href); if (g.file) return bring(await normalize(g.file), host + ' image'); } } catch (e2) {}
        throw new Error(host + ': ' + e.message);
      }
    }
    setStatus('dropstatus', 'Downloading from ' + host + '…');
    got = await download(url);
    if (got.file) return bring(await normalize(got.file), host);
    var media = ogMedia(got.html);
    if (media) { var g2 = await download(new URL(media, got.url).href); if (g2.file) return bring(await normalize(g2.file), host); }
    return bring(await normalize(await ytdlp(url, host)), host);     // last try: yt-dlp knows ~1,800 sites
  }
  async function fromLinks(list) {
    var ok = 0, fails = [];
    for (var i = 0; i < list.length; i++) {
      if (list.length > 1) setStatus('dropstatus', 'Link ' + (i + 1) + ' of ' + list.length + '…');
      try { if (await fromLink(list[i]) !== false) ok++; } catch (e) { fails.push(e.message); }
    }
    if (fails.length) setStatus('dropstatus', (ok ? ok + ' imported. ' : '') + fails.length + ' failed: ' + fails[0], 'bad');
  }

  $('paste').addEventListener('click', function () { guard(pasteFromClipboard); });
  function goUrl() { var l = linksIn($('url').value); if (!l.length) { setStatus('dropstatus', 'Paste a full link starting with http.', 'warn'); return; } guard(function () { return fromLinks(l); }); }
  $('urlgo').addEventListener('click', goUrl);
  $('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') goUrl(); });
  $('dropsdir').addEventListener('click', async function () { await refresh(); cp.execFile('/usr/bin/open', [assetDir('Drops')]); });
  // ⌘V while the panel has focus
  document.addEventListener('paste', function (e) {
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    if (!document.querySelector('#tab-drop:not([hidden])')) return;
    var items = e.clipboardData ? e.clipboardData.items : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var file = items[i].getAsFile(); e.preventDefault();
        var fr = new FileReader();
        fr.onload = function () { guard(function () { var out = uniq(assetDir('Drops'), 'paste-' + stamp(), '.png'); fs.writeFileSync(out, Buffer.from(fr.result)); return bring(out, 'Clipboard image'); }); };
        fr.readAsArrayBuffer(file); return;
      }
    }
    var links = linksIn(e.clipboardData && e.clipboardData.getData('text'));
    if (links.length) { e.preventDefault(); $('url').value = links.join(' '); guard(function () { return fromLinks(links); }); return; }
    e.preventDefault(); guard(pasteFromClipboard);
  });
  // drag files / folders / links in
  var dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (document.querySelector('#tab-drop:not([hidden])')) dz.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); if (ev === 'drop' || e.target === dz) dz.classList.remove('over'); }); });
  document.addEventListener('drop', function (e) {
    if (!document.querySelector('#tab-drop:not([hidden])')) return;
    var files = Array.prototype.slice.call(e.dataTransfer.files || []).map(function (f) { return f.path; }).filter(Boolean);
    var links = linksIn(e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text'));
    guard(async function () {
      if (files.length) { for (var i = 0; i < files.length; i++) { if (files.length > 1) setStatus('dropstatus', 'Importing ' + (i + 1) + ' of ' + files.length + '…'); await bringLocal(files[i], 'Dragged file'); } return; }
      if (links.length) return fromLinks(links);
      setStatus('dropstatus', 'Nothing usable was dropped.', 'warn');
    });
  });

  // ================= TEMPLATES =================
  // For now only the team's picks from the Adobe template library: Carousel 01–05 and 1–4.
  var TPL_DIR = path.join(os.homedir(), 'Library/Application Support/Adobe/Common/Motion Graphics Templates');
  var TPL_PICK = /^(carousel\s*\d+|[1-4])$/i;
  var tpl = { all: [], sel: null };
  function scanTemplates() {
    var names = []; try { names = fs.readdirSync(TPL_DIR); } catch (e) {}
    tpl.all = names.filter(function (n) { return /\.mogrt$/i.test(n) && TPL_PICK.test(n.replace(/\.mogrt$/i, '')); }).map(function (n) {
      var p = path.join(TPL_DIR, n), st = fs.statSync(p);
      return { path: p, name: n.replace(/\.mogrt$/i, ''), mtime: st.mtimeMs, group: /^carousel/i.test(n) ? 'Carousel' : 'Numbers' };
    }).sort(function (a, b) { return a.group === b.group ? a.name.localeCompare(b.name, undefined, { numeric: true }) : (a.group === 'Carousel' ? -1 : 1); });
    renderTemplates();
  }
  function thumbFor(t, kind) { return path.join(CACHE, crypto.createHash('md5').update(t.path + ':' + t.mtime).digest('hex') + (kind === 'mp4' ? '.mp4' : '.png')); }
  async function extractThumb(t, kind) {
    var out = thumbFor(t, kind);
    if (fs.existsSync(out)) return fs.statSync(out).size ? out : null;
    var r = await run('/usr/bin/unzip', ['-p', t.path, 'thumb.' + kind], { encoding: 'buffer' });
    try { fs.writeFileSync(out, r.err ? Buffer.alloc(0) : r.out); } catch (e) {}
    return !r.err && r.out && r.out.length ? out : null;
  }
  function renderTemplates() {
    var box = $('tpls');
    $('tplcount').textContent = tpl.all.length ? tpl.all.length + ' templates' : '';
    if (!tpl.all.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">No templates found in the Adobe template library.</div>'; return; }
    box.innerHTML = tpl.all.map(function (t, i) {
      return '<div class="card' + (tpl.sel === t ? ' on' : '') + '" data-i="' + i + '" title="' + esc(t.path) + '"><div class="pv"></div><div class="meta"><span class="n">' + esc(t.name) + '</span><span class="t">' + esc(t.group) + '</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.card'), function (card) {
      var t = tpl.all[+card.getAttribute('data-i')];
      extractThumb(t, 'png').then(function (p) { if (p) card.querySelector('.pv').innerHTML = '<img src="' + fileUrl(p) + '">'; });
      card.addEventListener('click', function () { tpl.sel = t; Array.prototype.forEach.call(box.querySelectorAll('.card'), function (c) { c.classList.toggle('on', c === card); }); $('tpladd').disabled = false; $('tpladd').textContent = 'Add “' + t.name + '” at playhead'; });
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
    setStatus('tplstatus', r.error || tpl.sel.name + ' added at the playhead on ' + r.track + '. Edit it in Essential Graphics.', r.error ? 'bad' : 'ok');
  }
  $('tpladd').addEventListener('click', addTemplate);
  $('tplrescan').addEventListener('click', scanTemplates);

  // ================= MOTION =================
  var motion = { list: readJson('catalog/motion.json').presets || [], tag: 'all', sel: null };
  function renderMotion() {
    var box = $('motions');
    var list = motion.list.filter(function (m) { return motion.tag === 'all' || m.tag === motion.tag; });
    box.innerHTML = list.map(function (m, i) {
      return '<div class="card m-' + esc(m.id) + (motion.sel === m ? ' on' : '') + '" data-id="' + esc(m.id) + '"><div class="pv"><div class="mframe"><div class="mclip photo" style="background-image:url(&quot;' + photo(i + 3) + '&quot;)"></div></div></div>' +
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

  // shared by Tools
  function frameWH() { return info.width && info.height ? [info.width, info.height] : [1080, 1920]; }
  function fmtT(s) { var m = Math.floor(s / 60), r = Math.floor(s - m * 60); return m + ':' + (r < 10 ? '0' : '') + r; }

  // ================= PREVIEW PHOTOS (shipped in the panel: work offline, no Premiere needed) =================
  var PHOTOS = (function () { try { return fs.readdirSync(path.join(EXT_DIR, 'assets', 'preview')).filter(function (n) { return /\.(jpe?g|png|webp)$/i.test(n); }).sort(); } catch (e) { return []; } })()
    .map(function (n) { return fileUrl(path.join(EXT_DIR, 'assets', 'preview', n)); });
  function photo(i) { return PHOTOS.length ? PHOTOS[((i % PHOTOS.length) + PHOTOS.length) % PHOTOS.length] : ''; }
  var photoImg = new Image(); photoImg.onload = function () { if (tabsSeen.tools) previewMatte(); }; if (PHOTOS.length) photoImg.src = photo(8);

  // ================= FRAME (Effects preview) =================
  // Default: every card shows its own photo. "Grab playhead frame" puts your footage on all of them; "Photos" goes back.
  var frame = { url: null, img: null };
  function setFrame(url) {
    frame.url = url;
    var img = new Image(); img.onload = function () { frame.img = img; }; img.src = url;
    $('fx').style.setProperty('--frame', 'url("' + url + '")');
    $('fx').classList.add('own'); $('fxphotos').hidden = false;
  }
  function usePhotos() {
    frame.url = null; frame.img = null; $('fx').classList.remove('own'); $('fxphotos').hidden = true;
    $('fxframe').textContent = 'Preview on Anik photos';
  }
  async function grabFrame(silent) {
    await refresh();
    if (!info.sequence) { if (!silent) setStatus('fxstatus', 'Open a sequence to preview on your own footage.', 'warn'); return false; }
    var base = path.join(CACHE, 'playhead');
    try { fs.unlinkSync(base + '.png'); } catch (e) {}
    var r = await evalJsx('ahFrame(' + q(base) + ')');
    var f = [base + '.png', base + '.jpg', base].filter(function (p) { return fs.existsSync(p); })[0];
    if (!/^OK/.test(r) || !f) { if (!silent) setStatus('fxstatus', 'Could not grab the frame: ' + r, 'warn'); return false; }
    setFrame(fileUrl(f) + '?t=' + Date.now());
    $('fxframe').textContent = 'Preview on your playhead frame';
    return true;
  }
  $('fxgrab').addEventListener('click', function () { grabFrame(false); });
  $('fxphotos').addEventListener('click', usePhotos);

  // ================= TEXT =================
  // Editable captions only, nothing rendered. Lines come from an SRT / VTT, the sequence's caption track, or a typed line,
  // are re-chunked to one line each, then placed as (a) one Graphics clip per line from a .mogrt, or (b) a native caption track.
  // Both stay fully editable in Premiere; Size / Position below restyle every placed line at once.
  var CAP = nodeReq(path.join(EXT_DIR, 'lib', 'captions.js'));
  var PRC = nodeReq(path.join(EXT_DIR, 'lib', 'prcaptions.js'));
  var text = {
    src: load('ah:tsrc', 'srt'), out: load('ah:tout', 'graphics'), at: load('ah:tat', 'zero'),
    opt: Object.assign({ maxWords: 4, maxChars: 28, upper: false, dropPunct: false }, load('ah:topt', {})),
    srt: load('ah:tsrtfile', ''), tpl: load('ah:ttpl', ''), pct: load('ah:tpct', 100), off: load('ah:toff', 0), dur: load('ah:tdur', 3),
    cues: [], lines: [], tpls: [], last: load('ah:tlast', null)
  };
  if (['srt', 'captions', 'line'].indexOf(text.src) < 0) text.src = 'srt';

  // ---- templates: any .mogrt with a text field (Premiere-made Graphics work best) ----
  var CAP_TPL_DIR = path.join(HOME, 'Caption Templates');
  try { fs.mkdirSync(CAP_TPL_DIR, { recursive: true }); } catch (e) {}
  function walkMogrt(dir, depth, out) {
    var names = []; try { names = fs.readdirSync(dir); } catch (e) { return; }
    names.forEach(function (n) {
      var p = path.join(dir, n), st; try { st = fs.statSync(p); } catch (e) { return; }
      if (st.isDirectory() && depth > 0 && !/\.app$/i.test(n)) walkMogrt(p, depth - 1, out);
      else if (/\.mogrt$/i.test(n)) out.push(p);
    });
  }
  function appGraphicsDirs() {
    var out = [];
    try {
      fs.readdirSync('/Applications').filter(function (n) { return /^Adobe Premiere Pro/i.test(n); }).forEach(function (d) {
        var root = path.join('/Applications', d);
        (fs.readdirSync(root) || []).filter(function (n) { return /\.app$/i.test(n); }).forEach(function (a) { out.push(path.join(root, a, 'Contents', 'Essential Graphics')); });
      });
    } catch (e) {}
    return out;
  }
  function scanCapTemplates() {
    var found = [];
    walkMogrt(CAP_TPL_DIR, 2, found);
    walkMogrt(TPL_DIR, 1, found);
    appGraphicsDirs().forEach(function (d) { walkMogrt(d, 3, found); });
    if (text.tpl && fs.existsSync(text.tpl) && found.indexOf(text.tpl) < 0) found.unshift(text.tpl);
    var rank = function (p) { var n = path.basename(p); return p.indexOf(CAP_TPL_DIR) === 0 ? 0 : /caption|subtitle/i.test(n) ? 1 : /title|text|lower/i.test(n) ? 2 : 3; };
    text.tpls = found.filter(function (p, i) { return found.indexOf(p) === i; })
      .sort(function (a, b) { return rank(a) - rank(b) || path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }); });
    if (!text.tpl || text.tpls.indexOf(text.tpl) < 0) text.tpl = text.tpls[0] || '';
    paintTemplates();
  }
  function tplLabel(p) {
    var where = p.indexOf(CAP_TPL_DIR) === 0 ? 'Arena' : p.indexOf(TPL_DIR) === 0 ? 'Library' : /Essential Graphics/.test(p) ? 'Premiere' : 'Custom';
    return path.basename(p).replace(/\.mogrt$/i, '') + '  ·  ' + where;
  }
  function paintTemplates() {
    var sel = $('ttpl');
    sel.innerHTML = text.tpls.length ? text.tpls.map(function (p) { return '<option value="' + esc(p) + '"' + (p === text.tpl ? ' selected' : '') + '>' + esc(tplLabel(p)) + '</option>'; }).join('')
      : '<option value="">No .mogrt found: Choose…</option>';
  }
  $('ttpl').addEventListener('change', function () { text.tpl = this.value; store('ah:ttpl', text.tpl); });
  function pickFile(title, types) {
    try { var r = window.cep.fs.showOpenDialogEx(false, false, title, '', types); return r && r.data && r.data[0] ? r.data[0] : ''; }
    catch (e) { try { var r2 = window.cep.fs.showOpenDialog(false, false, title, '', types); return r2 && r2.data && r2.data[0] ? r2.data[0] : ''; } catch (e2) { return ''; } }
  }
  function useTemplate(p) {
    if (!p) return;
    var dest = path.join(CAP_TPL_DIR, path.basename(p));      // keep a copy so it survives the original moving
    try { if (p.indexOf(CAP_TPL_DIR) !== 0) fs.copyFileSync(p, dest); else dest = p; } catch (e) { dest = p; }
    text.tpl = dest; store('ah:ttpl', dest); scanCapTemplates();
    setStatus('tstatus', 'Template: ' + path.basename(dest), 'ok');
  }
  $('ttplpick').addEventListener('click', function () { useTemplate(pickFile('Choose a caption .mogrt', ['mogrt'])); });

  // ---- source ----
  function paintSource() {
    Array.prototype.forEach.call(document.querySelectorAll('#tsrc button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === text.src); });
    $('tsrcsrt').hidden = text.src !== 'srt'; $('tsrccap').hidden = text.src !== 'captions'; $('tsrcline').hidden = text.src !== 'line';
    $('tsrtname').textContent = text.srt ? path.basename(text.srt) : 'Drop an .srt / .vtt here, or click to choose';
    $('tsrtbox').classList.toggle('has', !!text.srt);
    Array.prototype.forEach.call(document.querySelectorAll('#tat button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === text.at); });
  }
  segValue('tsrc', function (v) { text.src = v; store('ah:tsrc', v); paintSource(); loadSource(true); });
  segValue('tat', function (v) { text.at = v; store('ah:tat', v); });
  function loadSrt(p) {
    if (!p) return;
    try {
      var cues = CAP.parse(fs.readFileSync(p, 'utf8'));
      if (!cues.length) { setStatus('tstatus', path.basename(p) + ' has no timed captions.', 'warn'); return; }
      text.srt = p; store('ah:tsrtfile', p); text.cues = cues; paintSource(); rechunk();
      setStatus('tstatus', cues.length + ' captions read from ' + path.basename(p) + '.', 'ok');
    } catch (e) { setStatus('tstatus', 'Could not read ' + path.basename(p) + ': ' + e.message, 'bad'); }
  }
  $('tsrtbox').addEventListener('click', function () { loadSrt(pickFile('Choose captions', ['srt', 'vtt'])); });
  $('tcapread').addEventListener('click', function () { loadSource(false); });
  $('tline').addEventListener('input', function () { if (text.src === 'line') loadSource(true); });
  async function loadSource(quiet) {
    text.cues = [];
    if (text.src === 'srt') {
      if (text.srt && fs.existsSync(text.srt)) { try { text.cues = CAP.parse(fs.readFileSync(text.srt, 'utf8')); } catch (e) {} }
    } else if (text.src === 'line') {
      var t = $('tline').value.trim(); if (t) text.cues = [{ start: 0, end: +text.dur, text: t }];
    } else if (!quiet) {              // caption track: saves the project, so only on request
      await refresh();
      if (!info.sequence) { setStatus('tstatus', 'Open the sequence with the captions.', 'warn'); return rechunk(); }
      try {
        setStatus('tstatus', 'Saving and reading the caption track…');
        var sv = await jsx('ahSave()'); if (sv.error) throw new Error(sv.error);
        var r = PRC.readCaptions(sv.path, info.seqId);
        if (!r.tracks.length) throw new Error('This sequence has no caption track. Text panel › Transcript › Create captions, or use an SRT.');
        text.cues = r.tracks[0].map(function (c) { return { start: c.start, end: c.end, text: String(c.text).replace(/\s+/g, ' ').trim() }; }).filter(function (c) { return c.text; });
        setStatus('tstatus', text.cues.length + ' captions read from the caption track. Placing on Graphics keeps their timing; hide the old caption track afterwards.', 'ok');
      } catch (e) { setStatus('tstatus', e.message, 'bad'); }
    } else {
      setStatus('tstatus', 'Read the caption track to load it (this saves the project first).');
    }
    rechunk();
  }

  // ---- lines: one line per caption ----
  var LINE_OPTS = [
    { k: 'maxWords', l: 'Words / line', min: 1, max: 10, step: 1, f: function (v) { return v; } },
    { k: 'maxChars', l: 'Max chars', min: 8, max: 60, step: 1, f: function (v) { return v; } }
  ];
  function renderLineOpts() {
    var o = text.opt;
    $('topts').innerHTML = LINE_OPTS.map(function (d, i) {
      return '<label>' + d.l + '</label><div class="ctl"><input type="range" data-i="' + i + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + o[d.k] + '"><span class="val">' + d.f(o[d.k]) + '</span></div>';
    }).join('') +
      '<label>Case</label><div class="ctl"><div class="seg" id="tcase"><button data-v="0" class="' + (o.upper ? '' : 'on') + '">As written</button><button data-v="1" class="' + (o.upper ? 'on' : '') + '">ALL CAPS</button></div></div>' +
      '<label>Punctuation</label><div class="ctl"><div class="seg" id="tpunct"><button data-v="0" class="' + (o.dropPunct ? '' : 'on') + '">Keep</button><button data-v="1" class="' + (o.dropPunct ? 'on' : '') + '">Drop , . ; :</button></div></div>';
    Array.prototype.forEach.call($('topts').querySelectorAll('input[type=range]'), function (el) {
      var d = LINE_OPTS[+el.getAttribute('data-i')];
      el.addEventListener('input', function () { o[d.k] = +el.value; el.nextSibling.textContent = d.f(+el.value); store('ah:topt', o); rechunkSoon(); });
    });
    segValue('tcase', function (v) { o.upper = v === '1'; store('ah:topt', o); rechunk(); });
    segValue('tpunct', function (v) { o.dropPunct = v === '1'; store('ah:topt', o); rechunk(); });
  }
  var rcTimer; function rechunkSoon() { clearTimeout(rcTimer); rcTimer = setTimeout(rechunk, 120); }
  function fmtTc(s) { var m = Math.floor(s / 60), r = s - m * 60; return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1); }
  function rechunk() {
    text.lines = text.src === 'line' ? text.cues.map(function (c) { return Object.assign({}, c, { text: text.opt.upper ? c.text.toUpperCase() : c.text }); }) : CAP.chunk(text.cues, text.opt);
    var box = $('tlines');
    $('tcount').textContent = text.lines.length ? text.lines.length + ' line' + (text.lines.length > 1 ? 's' : '') : '';
    if (!text.lines.length) { box.innerHTML = '<div class="empty">' + (text.src === 'captions' ? 'Read the caption track to see its lines.' : text.src === 'line' ? 'Type a line above.' : 'Choose an SRT to see its lines.') + '</div>'; paintPlace(); return; }
    box.innerHTML = text.lines.map(function (l, i) {
      return '<div class="cline"><span class="tc">' + fmtTc(l.start) + '</span><input data-i="' + i + '" value="' + esc(l.text) + '" spellcheck="false"></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('input'), function (el) {
      el.addEventListener('input', function () { text.lines[+el.getAttribute('data-i')].text = el.value; });
    });
    paintPlace();
  }

  // ---- output ----
  function paintOut() {
    Array.prototype.forEach.call(document.querySelectorAll('#tout button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === text.out); });
    $('tgfx').hidden = text.out !== 'graphics';
    $('tadjust').hidden = text.out !== 'graphics';
    $('tcapnote').hidden = text.out !== 'track';
    paintPlace();
  }
  segValue('tout', function (v) { text.out = v; store('ah:tout', v); paintOut(); });
  function paintPlace() {
    var n = text.lines.length, b = $('tplace');
    b.disabled = !n;
    b.textContent = !n ? 'No lines yet' : text.out === 'track' ? 'Add caption track (' + n + ')' : 'Place ' + n + ' text clip' + (n > 1 ? 's' : '');
  }
  function offsetFor() { return text.src === 'captions' ? 0 : (text.src === 'line' || text.at === 'playhead') ? (info.playhead || 0) : 0; }
  function liveLines() { return text.lines.map(function (l) { return { start: l.start, end: l.end, text: String(l.text).replace(/\s+/g, ' ').trim() }; }).filter(function (l) { return l.text; }); }
  function writeSrt(lines, off) {
    var out = uniq(assetDir('Text'), safeName((info.sequence || 'captions') + ' - lines') + '-' + stamp(), '.srt');
    fs.writeFileSync(out, CAP.toSrt(lines, off), 'utf8');
    return out;
  }

  $('tplace').addEventListener('click', async function () {
    if (busy) return;
    await refresh();
    if (!info.sequence) return setStatus('tstatus', 'Open a sequence first.', 'warn');
    var lines = liveLines(); if (!lines.length) return setStatus('tstatus', 'No lines to place.', 'warn');
    var off = offsetFor(), bar = $('tprog').firstElementChild;
    busy = true; $('tplace').disabled = true; $('tprog').hidden = false; bar.style.width = '0';
    try {
      if (text.out === 'track') {
        setStatus('tstatus', 'Making the caption track…');
        var srt = writeSrt(lines, off), r = await jsx('ahCaptionTrack(' + q(srt) + ')');
        if (r.error) throw new Error(r.error);
        bar.style.width = '100%';
        setStatus('tstatus', lines.length + ' one-line captions added as a caption track. Select them all in the timeline to change font, size and position together in Essential Graphics.', 'ok');
      } else {
        if (!text.tpl || !fs.existsSync(text.tpl)) throw new Error('Choose a caption template (.mogrt) first, or switch Output to Caption track.');
        var a = lines[0].start + off, z = lines[lines.length - 1].end + off;
        var tr = await jsx('ahTrackFor(' + a + ',' + (z + 10) + ',1)');
        if (tr.error) throw new Error(tr.error);
        var placed = 0, textSet = 0, base = 0, unit = '%', BATCH = 12;
        for (var i = 0; i < lines.length; i += BATCH) {
          var part = lines.slice(i, i + BATCH).map(function (l) { return { s: l.start + off, e: l.end + off, t: l.text }; });
          setStatus('tstatus', 'Placing ' + Math.min(i + BATCH, lines.length) + ' of ' + lines.length + '…');
          var rb = await jsx('ahCapBatch(' + q(text.tpl) + ',' + tr.track + ',' + q(JSON.stringify(part)) + ',' + (+text.pct) + ')');
          if (rb.error) throw new Error(rb.error);
          placed += rb.placed; textSet += rb.textSet;
          if (!base && rb.base) { base = rb.base; unit = rb.unit; } else if (i === 0) unit = rb.unit;
          bar.style.width = Math.round(Math.min(i + BATCH, lines.length) / lines.length * 100) + '%';
        }
        if (!placed) throw new Error('Premiere refused this template. Try a Premiere-made Graphics .mogrt.');
        text.last = { seq: info.seqId, track: tr.track, a: a, b: z, base: base, unit: unit }; store('ah:tlast', text.last);
        paintAdjust();
        var note = textSet < placed ? ' The template has no text field Arena can write, so ' + (placed - textSet) + ' show its default text: pick another template.' : '';
        setStatus('tstatus', placed + ' editable text clips on V' + (tr.track + 1) + (tr.added ? ' (new track)' : '') + '. Double-click any one to edit it; Size and Position below change them all.' + note, note ? 'warn' : 'ok');
      }
    } catch (e) { setStatus('tstatus', e.message || String(e), 'bad'); }
    busy = false; paintPlace(); setTimeout(function () { $('tprog').hidden = true; }, 800);
  });
  $('tsave').addEventListener('click', async function () {
    await refresh();
    var lines = liveLines(); if (!lines.length) return setStatus('tstatus', 'No lines to save.', 'warn');
    try { var p = writeSrt(lines, offsetFor()); cp.execFile('/usr/bin/open', ['-R', p]); setStatus('tstatus', 'Saved ' + path.basename(p) + ' (' + lines.length + ' one-line captions).', 'ok'); }
    catch (e) { setStatus('tstatus', e.message, 'bad'); }
  });

  // ---- adjust placed captions: Size / Position on the selection, else on the last batch ----
  function paintAdjust() {
    $('tpct').value = text.pct; $('tpctv').textContent = text.pct + '%';
    $('toffs').value = text.off; $('toffv').textContent = (text.off > 0 ? '+' : '') + text.off + '%';
    $('tadjnote').textContent = text.last ? 'Changes the selected captions, or the last batch on V' + (text.last.track + 1) + ' when nothing is selected.' : 'Size is used when placing. After placing, it changes the selected captions, or the whole batch.';
  }
  var adjTimer;
  function adjust(which) {
    clearTimeout(adjTimer);
    adjTimer = setTimeout(async function () {
      if (busy) return;
      await refresh();
      var L = text.last && text.last.seq === info.seqId ? text.last : null;
      if (!L && !info.selected) return;
      var r = await jsx('ahCapStyle(' + (L ? L.track : -1) + ',' + (L ? L.a : 0) + ',' + (L ? L.b : 0) + ',' + (which === 'size' ? +text.pct : 'null') + ',' + (L && L.base ? L.base : 0) + ',' + (which === 'pos' ? +text.off : 'null') + ')');
      if (r.error) return setStatus('tstatus', r.error, 'bad');
      setStatus('tstatus', (which === 'size' ? 'Size ' + text.pct + '%' : 'Position ' + (text.off > 0 ? '+' : '') + text.off + '%') + ' on ' + r.done + (r.selection ? ' selected' : '') + ' caption' + (r.done === 1 ? '' : 's') + (r.miss ? ' (' + r.miss + ' had no size / position to change)' : '') + '.', r.miss ? 'warn' : 'ok');
    }, 260);
  }
  $('tpct').addEventListener('input', function () { text.pct = +this.value; store('ah:tpct', text.pct); $('tpctv').textContent = text.pct + '%'; adjust('size'); });
  $('toffs').addEventListener('input', function () { text.off = +this.value; store('ah:toff', text.off); $('toffv').textContent = (text.off > 0 ? '+' : '') + text.off + '%'; adjust('pos'); });
  $('tdur').addEventListener('input', function () { text.dur = +this.value; store('ah:tdur', text.dur); $('tdurv').textContent = text.dur + 's'; loadSource(true); });

  // drop an .srt / .vtt / .mogrt anywhere on the Text tab
  document.addEventListener('drop', function (e) {
    if (!document.querySelector('#tab-text:not([hidden])')) return;
    var f = Array.prototype.slice.call(e.dataTransfer.files || []).map(function (x) { return x.path; }).filter(Boolean)[0];
    if (!f) return;
    if (/\.(srt|vtt)$/i.test(f)) { text.src = 'srt'; store('ah:tsrc', 'srt'); loadSrt(f); }
    else if (/\.mogrt$/i.test(f)) { text.out = 'graphics'; store('ah:tout', 'graphics'); paintOut(); useTemplate(f); }
    else setStatus('tstatus', 'Drop an .srt, .vtt or .mogrt here.', 'warn');
  });

  function renderText() {
    $('tdur').value = text.dur; $('tdurv').textContent = text.dur + 's';
    renderLineOpts(); paintSource(); paintOut(); paintAdjust(); scanCapTemplates(); loadSource(true);
  }

  // ================= EFFECTS =================
  var fx = { list: readJson('catalog/effects.json').recipes || [], group: 'Trending', sel: null };
  function renderFx() {
    var list = fx.list.filter(function (r) { return r.group === fx.group; });
    $('fx').innerHTML = list.map(function (r, i) {
      var uses = (r.fx || []).map(function (f) { return f.effect; }).concat(r.keys && r.keys.length ? ['keyframes'] : []).join(' + ');
      return '<div class="card pv-' + esc(r.pv) + (fx.sel === r ? ' on' : '') + '" data-id="' + esc(r.id) + '" title="' + esc(r.desc + '\n' + uses) + '" style="--photo:url(&quot;' + photo(i) + '&quot;)">' +
        '<div class="pv"><div class="fv"><div class="im"></div><div class="im2"></div><div class="im3"></div><div class="ov"></div><div class="ov ov2"></div></div></div>' +
        '<div class="meta"><span class="n">' + esc(r.name) + '</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#fx .card'), function (card) {
      card.addEventListener('click', function () {
        fx.sel = fx.list.filter(function (r) { return r.id === card.getAttribute('data-id'); })[0];
        Array.prototype.forEach.call(document.querySelectorAll('#fx .card'), function (x) { x.classList.toggle('on', x === card); });
        setStatus('fxstatus', fx.sel.desc);
        paintFxButton();
      });
      card.addEventListener('dblclick', applyFx);
    });
  }
  segValue('fxgroup', function (v) { fx.group = v; renderFx(); });
  function paintFxButton() {
    var b = $('fxapply'); if (!b) return;
    if (!fx.sel) { b.disabled = true; b.textContent = 'Select an effect'; return; }
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
    else setStatus('fxstatus', fx.sel.name + ' on ' + r.clips + ' clip' + (r.clips === 1 ? '' : 's') + (r.missing.length ? '. Not set: ' + r.missing.join(', ') : '. Tune it in Effect Controls.'), r.missing.length ? 'warn' : 'ok');
    paintFxButton();
  }
  $('fxapply').addEventListener('click', applyFx);

  // ================= TOOLS =================
  // Smart place over the selected section: adjustment layer (optionally with an Effects recipe) or a generated matte / overlay.
  var ADJ_TEMPLATE = path.join(EXT_DIR, 'assets', 'arena-adjustment.prproj');
  var tools = { range: load('ah:trange', 'selection'), per: load('ah:tper', 'one'), mtype: load('ah:mtype', 'solid'),
    m: Object.assign({ a: '#000000', b: '#1b2a4a', alpha: 100, strength: 70, bars: 12, platform: 'reels', dir: 'vertical' }, load('ah:mprops', {})) };
  var MPROPS = {
    solid:    [['a', 'Colour', 'color'], ['alpha', 'Opacity', 'range', 0, 100]],
    gradient: [['a', 'Top', 'color'], ['b', 'Bottom', 'color'], ['alpha', 'Opacity', 'range', 0, 100], ['dir', 'Direction', 'seg', [['vertical', 'Vertical'], ['diagonal', 'Diagonal']]]],
    vignette: [['a', 'Colour', 'color'], ['strength', 'Strength', 'range', 10, 100]],
    bars:     [['a', 'Colour', 'color'], ['bars', 'Bar size', 'range', 2, 30]],
    safe:     [['platform', 'Platform', 'seg', [['reels', 'Reels'], ['tiktok', 'TikTok'], ['shorts', 'Shorts']]]]
  };
  function toolsArgs() { return q(tools.range === 'inout' ? 'inout' : 'selection') + ',' + (tools.per === 'each' ? 'true' : 'false'); }
  function paintSegs() {
    [['trange', tools.range], ['tper', tools.per], ['mtype', tools.mtype]].forEach(function (p) {
      Array.prototype.forEach.call(document.querySelectorAll('#' + p[0] + ' button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === p[1]); });
    });
    $('tper').style.opacity = tools.range === 'inout' ? .35 : 1;
  }
  async function rangeInfo() {
    if ($('tab-tools').hidden) return;
    var r = await jsx('ahRangeInfo(' + toolsArgs() + ')');
    if (r.error) { $('trinfo').textContent = r.error; $('trinfo').className = 'end tone-warn'; return; }
    var g = r.ranges, a = g[0], z = g[g.length - 1], tr = g.map(function (x) { return x.track < 0 ? 'new track' : 'V' + (x.track + 1); }).filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    $('trinfo').className = 'end';
    $('trinfo').textContent = (g.length > 1 ? g.length + ' sections · ' : '') + fmtT(a.start) + '.' + Math.floor(a.start % 1 * 10) + ' – ' + fmtT(z.end) + '.' + Math.floor(z.end % 1 * 10) + ' → ' + tr.join(', ');
  }
  function renderTools() {
    var sel = $('adjfx');
    sel.innerHTML = '<option value="">None (empty adjustment layer)</option>' + ['Trending', 'In / Out', 'Looks', 'Arena'].map(function (g) {
      return '<optgroup label="' + g + '">' + fx.list.filter(function (r) { return r.group === g && !(r.keys || []).some(function (k) { return k.comp === 'Motion'; }); })      // Motion keys move the layer itself, not what is under it
        .map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
    sel.value = load('ah:adjfx', '');
    sel.addEventListener('change', function () { store('ah:adjfx', sel.value); });
    paintSegs(); renderMatteProps(); rangeInfo();
  }
  segValue('trange', function (v) { tools.range = v; store('ah:trange', v); paintSegs(); rangeInfo(); });
  segValue('tper', function (v) { tools.per = v; store('ah:tper', v); paintSegs(); rangeInfo(); });
  segValue('mtype', function (v) { tools.mtype = v; store('ah:mtype', v); renderMatteProps(); });

  function renderMatteProps() {
    var box = $('mprops'), m = tools.m;
    box.innerHTML = MPROPS[tools.mtype].map(function (d, i) {
      var c = d[2] === 'color' ? '<input type="color" data-i="' + i + '" value="' + m[d[0]] + '">'
        : d[2] === 'range' ? '<input type="range" data-i="' + i + '" min="' + d[3] + '" max="' + d[4] + '" value="' + m[d[0]] + '"><span class="val">' + m[d[0]] + '%</span>'
        : '<div class="seg" data-i="' + i + '">' + d[3].map(function (o) { return '<button data-v="' + o[0] + '" class="' + (m[d[0]] === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>';
      return '<label>' + d[1] + '</label><div class="ctl">' + c + '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('input'), function (el) {
      var d = MPROPS[tools.mtype][+el.getAttribute('data-i')];
      el.addEventListener('input', function () { m[d[0]] = d[2] === 'range' ? +el.value : el.value; if (d[2] === 'range') el.nextSibling.textContent = el.value + '%'; store('ah:mprops', m); previewMatte(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.seg'), function (sg) {
      var d = MPROPS[tools.mtype][+sg.getAttribute('data-i')];
      Array.prototype.forEach.call(sg.querySelectorAll('button'), function (b) { b.addEventListener('click', function () { m[d[0]] = b.getAttribute('data-v'); store('ah:mprops', m); renderMatteProps(); }); });
    });
    previewMatte();
  }
  // preview only: the matte over a photo. The exported matte (drawMatte) stays clean.
  function previewMatte() {
    var wh = frameWH(), pv = $('mprev'), W = 160, H = Math.round(160 * wh[1] / wh[0]);
    var off = document.createElement('canvas'); drawMatte(off, W, H);
    pv.width = W; pv.height = H; var x = pv.getContext('2d');
    x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, W, H);
    if (photoImg.complete && photoImg.naturalWidth) {
      var iw = photoImg.naturalWidth, ih = photoImg.naturalHeight, k = Math.max(W / iw, H / ih);
      x.drawImage(photoImg, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
    }
    x.drawImage(off, 0, 0);
  }
  function drawMatte(cv, W, H) {
    var x = cv.getContext('2d'), m = tools.m, t = tools.mtype;
    cv.width = Math.round(W); cv.height = Math.round(H); W = cv.width; H = cv.height;
    x.clearRect(0, 0, W, H);
    if (t === 'solid') { x.globalAlpha = m.alpha / 100; x.fillStyle = m.a; x.fillRect(0, 0, W, H); }
    if (t === 'gradient') {
      var g = m.dir === 'diagonal' ? x.createLinearGradient(0, 0, W, H) : x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, m.a); g.addColorStop(1, m.b); x.globalAlpha = m.alpha / 100; x.fillStyle = g; x.fillRect(0, 0, W, H);
    }
    if (t === 'vignette') {
      var r = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.62 - m.strength / 400), W / 2, H / 2, Math.hypot(W, H) / 2);
      r.addColorStop(0, hexA(m.a, 0)); r.addColorStop(1, hexA(m.a, Math.min(1, m.strength / 85)));
      x.fillStyle = r; x.fillRect(0, 0, W, H);
    }
    if (t === 'bars') { var bh = H * m.bars / 100; x.fillStyle = m.a; x.fillRect(0, 0, W, bh); x.fillRect(0, H - bh, W, bh); }
    if (t === 'safe') {
      // where each app's UI sits on a 9:16 frame (approximate), shaded so text and faces stay clear of it
      var Z = { reels: { top: 0.14, bottom: 0.35, right: 0.15 }, tiktok: { top: 0.12, bottom: 0.30, right: 0.16 }, shorts: { top: 0.12, bottom: 0.27, right: 0.14 } }[m.platform];
      x.fillStyle = 'rgba(255, 64, 64, .28)';
      x.fillRect(0, 0, W, H * Z.top); x.fillRect(0, H * (1 - Z.bottom), W, H * Z.bottom); x.fillRect(W * (1 - Z.right), H * Z.top, W * Z.right, H * (1 - Z.top - Z.bottom));
      x.strokeStyle = 'rgba(255, 255, 255, .9)'; x.lineWidth = Math.max(1, W / 360); x.setLineDash([W / 60, W / 90]);
      x.strokeRect(W * 0.06, H * Z.top, W * (0.94 - Z.right) - W * 0.06, H * (1 - Z.top - Z.bottom));
    }
    x.globalAlpha = 1;
  }
  function hexA(hex, a) { var n = parseInt(String(hex).replace('#', ''), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }

  async function toolsRun(fn) {
    if (busy) return; busy = true; $('adjgo').disabled = $('mattego').disabled = true;
    try { await refresh(); await fn(); } catch (e) { setStatus('toolstatus', e.message || String(e), 'bad'); }
    busy = false; $('adjgo').disabled = $('mattego').disabled = false; rangeInfo();
  }
  function placedMsg(what, r) {
    var where = (r.placed || []).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
    return r.placed && r.placed.length ? what + ' on ' + where + (r.placed.length > 1 ? ' (' + r.placed.length + ')' : '') + (r.notes && r.notes.length ? '. ' + r.notes.join(' ') : '.') : 'Nothing placed: ' + ((r.notes || []).join(' ') || 'no room');
  }
  $('adjgo').addEventListener('click', function () {
    toolsRun(async function () {
      var id = $('adjfx').value, rec = id ? fx.list.filter(function (r) { return r.id === id; })[0] : null;
      var r = await jsx('ahAddAdjust(' + toolsArgs() + ',' + q(ADJ_TEMPLATE) + ',' + (rec ? q(JSON.stringify(rec)) : '""') + ')');
      if (r.error === 'NOADJ') return setStatus('toolstatus', 'This project has no adjustment layer yet. Make one once (File › New › Adjustment Layer) and Arena will reuse it from then on.', 'warn');
      if (r.error) return setStatus('toolstatus', r.error, 'bad');
      var msg = placedMsg('Adjustment layer' + (rec ? ' with ' + rec.name : ''), r);
      if (r.fxError) msg += ' Effect not added: ' + r.fxError;
      else if (r.missing && r.missing.length) msg += ' Not set: ' + r.missing.join(', ');
      setStatus('toolstatus', msg, r.placed && r.placed.length && !r.fxError ? 'ok' : 'warn');
    });
  });
  $('mattego').addEventListener('click', function () {
    toolsRun(async function () {
      if (!info.sequence) throw new Error('Open a sequence first.');
      var wh = frameWH(), cv = document.createElement('canvas'); drawMatte(cv, wh[0], wh[1]);
      var m = tools.m, key = tools.mtype + '-' + [m.a, m.b, m.alpha, m.strength, m.bars, m.platform, m.dir].join('-').replace(/#/g, '') + '-' + wh[0] + 'x' + wh[1];
      var out = path.join(assetDir('Mattes'), safeName(key) + '.png');
      if (!fs.existsSync(out)) fs.writeFileSync(out, await blobBuf(cv));
      var label = { solid: 'Colour matte', gradient: 'Gradient', vignette: 'Vignette', bars: 'Bars', safe: 'Safe-zone guide' }[tools.mtype];
      var r = await jsx('ahAddStill(' + q(out) + ',' + toolsArgs() + ',"Arena Tools")');
      if (r.error) return setStatus('toolstatus', r.error, 'bad');
      setStatus('toolstatus', placedMsg(label, r) + (tools.mtype === 'safe' ? ' Turn it off before export.' : ''), r.placed && r.placed.length ? 'ok' : 'warn');
    });
  });

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
  window.addEventListener('focus', function () { var t = Date.now(); if (busy || t - lastFocus < 1200) return; lastFocus = t; refresh().then(rangeInfo);  });
})();
