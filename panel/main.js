/* Agentix Arena Hub — panel logic.
   Drop: clipboard / file / folder / any link -> <project>/Assets/Drops -> "Arena Drops" bin (+ playhead).
   Templates: the team's picks from the Adobe template library.
   Motion / Effects: catalog recipes on the selected clips. Text: canvas caption styles rendered to ProRes 4444 with alpha. */
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
    if ((name === 'effects' || name === 'text') && (!frame.url || /^data:/.test(frame.url))) grabFrame(true);
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
    if (!drops.length) { box.innerHTML = '<div class="empty">Nothing dropped yet.<br>Copy an image, a file or a link anywhere, then press Paste.</div>'; return; }
    box.innerHTML = drops.map(function (d, i) {
      var th = IMG_EXT.test(d.path) && fs.existsSync(d.path) ? ' style="background-image:url(\'' + fileUrl(d.path) + '\')"' : '';
      return '<div class="item"><div class="th"' + th + '></div><div><div class="n" title="' + esc(d.path) + '">' + esc(path.basename(d.path)) + '</div><div class="s">' + esc(d.src) + '</div></div>' +
        '<button data-i="' + i + '">Place</button></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { var d = drops[+b.getAttribute('data-i')]; if (d && fs.existsSync(d.path)) bring(d.path, d.src, true); else setStatus('dropstatus', 'That file was moved or deleted.', 'warn'); });
    });
  }
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

  // ================= FRAME (shared by Text and Effects previews) =================
  var frame = { url: null, img: null };
  function sampleFrame() {
    var c = document.createElement('canvas'); c.width = 640; c.height = 360; var x = c.getContext('2d');
    x.fillStyle = '#2b3442'; x.fillRect(0, 0, 640, 360); x.fillStyle = '#3d4a5e'; x.fillRect(0, 230, 640, 130);
    x.fillStyle = '#d9a37c'; x.beginPath(); x.arc(320, 150, 52, 0, 7); x.fill();
    x.fillStyle = '#1d2430'; x.beginPath(); x.ellipse(320, 340, 120, 120, 0, Math.PI, 0); x.fill();
    x.fillStyle = 'rgba(255,214,150,.9)'; x.beginPath(); x.arc(520, 70, 14, 0, 7); x.fill();
    return c.toDataURL('image/png');
  }
  function setFrame(url) {
    frame.url = url;
    var img = new Image(); img.onload = function () { frame.img = img; }; img.src = url;
    $('fx').style.setProperty('--frame', 'url("' + url + '")');
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
  $('tgrab').addEventListener('click', function () { grabFrame(false).then(function (ok) { if (ok) { text.bg = 'frame'; paintBg(); } }); });

  // ================= TEXT =================
  // Caption styles drawn by lib/textfx.js. Preview = final: "Render to timeline" writes a transparent ProRes 4444 .mov
  // into <project>/Assets/Text and places it at the playhead.
  var TXF = window.TXF;
  var FONT_CANDIDATES = ['Montserrat', 'Archivo', 'Clash Display', 'Unbounded', 'Urbanist', 'Manrope', 'Roboto', 'Roboto Condensed', 'Playfair Display', 'Instrument Serif', 'Inter', 'Helvetica Neue', 'Futura', 'Avenir Next', 'Impact'];
  function hasFont(f) {
    var c = document.createElement('canvas').getContext('2d'), s = 'mmmmmmmmmlliiWW@#';
    c.font = '40px monospace'; var a = c.measureText(s).width;
    c.font = '40px "' + f + '", monospace'; return c.measureText(s).width !== a;
  }
  var FONTS = FONT_CANDIDATES.filter(hasFont);
  var text = { style: load('ah:tstyle', 'rise'), P: Object.assign({}, TXF.DEFAULTS, load('ah:tprops', {})), bg: load('ah:tbg', 'frame'), t0: performance.now(), cards: [], raf: 0 };
  if (FONTS.indexOf(text.P.font) < 0) text.P.font = FONTS[0] || 'Montserrat';
  var BOXY = { boxline: 1, pill: 1, boxword: 1 }, PADDED = { boxline: 1, pill: 1, boxword: 1, hlbox: 1 }, ACCENTED = { karaoke: 1, hlbox: 1, boxword: 1, underline: 1, type: 1 };
  function frameWH() { return info.width && info.height ? [info.width, info.height] : [1080, 1920]; }
  function saveText() { store('ah:tprops', text.P); store('ah:tstyle', text.style); }

  // ---- properties ----
  var PROPS = [
    { k: 'font', l: 'Font', t: 'select', o: function () { return FONTS.map(function (f) { return [f, f]; }); } },
    { k: 'weight', l: 'Weight', t: 'select', o: function () { return [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']]; } },
    { k: 'size', l: 'Size', t: 'range', min: 2, max: 16, step: 0.25, f: function (v) { return v.toFixed(1); } },
    { k: 'upper', l: 'Case', t: 'seg', o: [[false, 'Aa'], [true, 'AA']] },
    { k: 'align', l: 'Align', t: 'seg', o: [['center', 'Centre'], ['left', 'Left']] },
    { sep: 1 },
    { k: 'color', l: 'Text', t: 'color' },
    { k: 'accent', l: 'Accent', t: 'color', also: 'onAccent', when: ACCENTED },
    { k: 'stroke', l: 'Outline', t: 'range', min: 0, max: 16, step: 1, also: 'strokeColor', f: function (v) { return v ? v + '%' : 'off'; } },
    { k: 'shadow', l: 'Shadow', t: 'seg', o: [[true, 'On'], [false, 'Off']] },
    { sep: 1 },
    { k: 'boxColor', l: 'Box', t: 'color', when: BOXY },
    { k: 'boxAlpha', l: 'Box opacity', t: 'range', min: 0, max: 100, step: 1, when: BOXY, f: function (v) { return v + '%'; } },
    { k: 'radius', l: 'Corners', t: 'range', min: 0, max: 50, step: 1, when: PADDED, f: function (v) { return v + '%'; } },
    { k: 'pad', l: 'Padding', t: 'range', min: 0, max: 80, step: 1, when: PADDED, f: function (v) { return v + '%'; } },
    { sep: 1 },
    { k: 'posY', l: 'Position', t: 'range', min: 5, max: 95, step: 1, f: function (v) { return v < 34 ? 'top ' + v : v > 66 ? 'low ' + v : 'mid ' + v; } },
    { k: 'maxW', l: 'Width', t: 'range', min: 30, max: 100, step: 1, f: function (v) { return v + '%'; } },
    { k: 'speed', l: 'Stagger', t: 'range', min: 0.02, max: 0.25, step: 0.005, f: function (v) { return Math.round(v * 1000) + 'ms'; } },
    { k: 'dur', l: 'Duration', t: 'range', min: 1, max: 10, step: 0.5, f: function (v) { return v + 's'; } }
  ];
  function renderProps() {
    var box = $('tprops'), P = text.P;
    box.innerHTML = PROPS.map(function (d, i) {
      if (d.sep) return '<div class="sep"></div>';
      var dim = d.when && !d.when[text.style] ? ' dim' : '', c = '';
      if (d.t === 'select') c = '<select data-i="' + i + '">' + d.o().map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(P[d.k]) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      if (d.t === 'range') c = '<input type="range" data-i="' + i + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + P[d.k] + '"><span class="val">' + d.f(+P[d.k]) + '</span>';
      if (d.t === 'seg') c = '<div class="seg" data-i="' + i + '">' + d.o.map(function (o, j) { return '<button data-j="' + j + '" class="' + (P[d.k] === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>';
      if (d.t === 'color') c = '<input type="color" data-i="' + i + '" value="' + P[d.k] + '">';
      if (d.also) c += '<input type="color" data-i="' + i + '" data-also="1" value="' + P[d.also] + '" title="' + (d.also === 'onAccent' ? 'Text on the accent' : 'Outline colour') + '">';
      return '<label class="' + dim + '">' + d.l + '</label><div class="ctl' + dim + '">' + c + '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('select,input'), function (el) {
      var d = PROPS[+el.getAttribute('data-i')], key = el.getAttribute('data-also') ? d.also : d.k;
      el.addEventListener('input', function () {
        P[key] = d.t === 'range' && !el.getAttribute('data-also') ? +el.value : d.k === 'weight' ? +el.value : el.value;
        if (d.t === 'range' && !el.getAttribute('data-also')) el.nextSibling.textContent = d.f(+el.value);
        saveText(); relayout();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.seg'), function (sg) {
      var d = PROPS[+sg.getAttribute('data-i')];
      Array.prototype.forEach.call(sg.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { P[d.k] = d.o[+b.getAttribute('data-j')][0]; saveText(); renderProps(); relayout(); });
      });
    });
  }
  $('treset').addEventListener('click', function () { text.P = Object.assign({}, TXF.DEFAULTS); if (FONTS.indexOf(text.P.font) < 0) text.P.font = FONTS[0]; saveText(); renderProps(); relayout(); });

  // ---- style cards + big preview ----
  function renderText() {
    var box = $('tstyles');
    box.innerHTML = TXF.STYLES.map(function (s) { return '<div class="scard' + (s.id === text.style ? ' on' : '') + '" data-id="' + s.id + '" title="' + esc(s.desc) + '"><canvas width="336" height="147"></canvas><div class="n">' + esc(s.name) + '</div></div>'; }).join('');
    text.cards = Array.prototype.map.call(box.querySelectorAll('.scard'), function (el) {
      el.addEventListener('click', function () {
        text.style = el.getAttribute('data-id'); saveText();
        Array.prototype.forEach.call(box.querySelectorAll('.scard'), function (x) { x.classList.toggle('on', x === el); });
        renderProps(); relayout();
      });
      return { id: el.getAttribute('data-id'), cv: el.querySelector('canvas'), ctx: el.querySelector('canvas').getContext('2d'), el: el };
    });
    renderProps(); paintBg(); relayout(); paintSource(true);
    if (!frame.url) setFrame(sampleFrame());
    if (!text.raf) loop();
  }
  function lineText() { return $('tline').value.trim() || 'Your line here'; }
  function previewText() { return text.src !== 'line' && text.preview ? text.preview : lineText(); }
  function relayout() {
    var wh = frameWH(), cv = $('tbig'), k = Math.min(1, 560 / Math.max(wh[0], wh[1]));
    if (cv.width !== Math.round(wh[0] * k) || cv.height !== Math.round(wh[1] * k)) { cv.width = Math.round(wh[0] * k); cv.height = Math.round(wh[1] * k); }
    text.k = k; text.t0 = performance.now();
    var st = TXF.STYLES.filter(function (s) { return s.id === text.style; })[0];
    $('tstylename').textContent = st ? st.name + ' · ' + st.desc : '';
    $('tsize').textContent = wh[0] + '×' + wh[1];
  }
  function paintBg() {
    Array.prototype.forEach.call(document.querySelectorAll('#tbg button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === text.bg); });
    $('tstage').classList.toggle('check', text.bg === 'check');
  }
  segValue('tbg', function (v) { text.bg = v; store('ah:tbg', v); paintBg(); if (v === 'frame' && frame.url && /^data:/.test(frame.url)) grabFrame(true); });
  function drawBg(ctx, W, H) {
    if (text.bg === 'check') { ctx.clearRect(0, 0, W, H); return; }
    ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, W, H);
    if (text.bg === 'frame' && frame.img) {
      var iw = frame.img.width, ih = frame.img.height, s = Math.max(W / iw, H / ih);
      ctx.globalAlpha = 0.85; ctx.drawImage(frame.img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); ctx.globalAlpha = 1;
    }
  }
  function loop() {
    text.raf = requestAnimationFrame(loop);
    if ($('tab-text').hidden) return;
    var P = text.P, span = P.dur + 0.6, t = ((performance.now() - text.t0) / 1000) % span, line = previewText();
    var wh = frameWH(), cv = $('tbig'), ctx = cv.getContext('2d');
    ctx.setTransform(text.k, 0, 0, text.k, 0, 0); drawBg(ctx, wh[0], wh[1]);
    TXF.draw(ctx, wh[0], wh[1], Math.min(t, P.dur), text.style, line, P);
    var small = Object.assign({}, P, { posY: 50, maxW: 94, size: 21, lineGap: 1.08, pad: Math.min(text.P.pad, 22) });
    text.cards.forEach(function (c) {
      var x = c.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, 336, 147); x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, 336, 147);
      TXF.draw(x, 336, 147, Math.min(t, P.dur), c.id, line, small);
    });
  }
  var tlTimer; $('tline').addEventListener('input', function () { clearTimeout(tlTimer); tlTimer = setTimeout(relayout, 200); });
  $('tdir').addEventListener('click', async function () { await refresh(); cp.execFile('/usr/bin/open', [assetDir('Text')]); });

  // ---- render: frames -> ffmpeg -> ProRes 4444 with alpha -> timeline ----
  // Sources: My line (at the playhead) · Captions (the sequence's caption track, read from the saved project)
  //          · Text clips (selected Graphics / text clips, each re-rendered in place on the track above).
  var PRC = nodeReq(path.join(EXT_DIR, 'lib', 'prcaptions.js'));
  text.src = load('ah:tsrc', 'line'); text.preview = null;
  function fpsOf(sec) {
    var f = sec ? 1 / sec : 30, near = function (x) { return Math.abs(f - x) < 0.02; };
    if (near(23.976)) return '24000/1001'; if (near(29.97)) return '30000/1001'; if (near(59.94)) return '60000/1001';
    return String(Math.round(f * 1000) / 1000);
  }
  function blobBuf(cv) {
    return new Promise(function (res, rej) {
      cv.toBlob(function (b) {
        if (!b) return rej(new Error('Frame could not be encoded.'));
        var fr = new FileReader(); fr.onload = function () { res(Buffer.from(fr.result)); }; fr.onerror = rej; fr.readAsArrayBuffer(b);
      }, 'image/png');
    });
  }
  function styleName() { return (TXF.STYLES.filter(function (s) { return s.id === text.style; })[0] || {}).name || text.style; }
  // segs: [{start, end, text}] in seconds from the file's first frame
  async function renderSegs(segs, total, label, progLabel) {
    var ff = which('ffmpeg'); if (!ff) throw new Error('ffmpeg is needed to render (brew install ffmpeg).');
    var P = Object.assign({}, text.P), W = info.width, H = info.height, fps = fpsOf(info.frame), fpsN = info.frame ? 1 / info.frame : 30;
    var n = Math.max(1, Math.round(total * fpsN)), st = text.style, bar = $('tprog').firstElementChild;
    var out = uniq(assetDir('Text'), safeName(styleName() + ' - ' + label) + '-' + stamp(), '.mov');
    await document.fonts.load(P.weight + ' 40px "' + P.font + '"');
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H; var ctx = cv.getContext('2d');
    var proc = cp.spawn(ff, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'png', '-i', '-',
      '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', out]);
    var errText = ''; proc.stderr.on('data', function (d) { errText += d; });
    var ended = new Promise(function (res) { proc.on('close', function (code) { res(code); }); });
    var empty = null, k = 0;
    segs.forEach(function (sg, i) { sg.noFade = !!(segs[i + 1] && segs[i + 1].start - sg.end < 0.12); });
    for (var i = 0; i < n; i++) {
      var T = i / fpsN;
      while (k < segs.length && segs[k].end <= T) k++;
      var sg = segs[k] && segs[k].start <= T ? segs[k] : null, buf;
      if (!sg) { if (!empty) { ctx.clearRect(0, 0, W, H); empty = await blobBuf(cv); } buf = empty; }
      else {
        ctx.clearRect(0, 0, W, H);
        TXF.draw(ctx, W, H, T - sg.start, st, sg.text, Object.assign({}, P, { dur: Math.max(0.5, sg.end - sg.start), noFade: sg.noFade }));
        buf = await blobBuf(cv);
      }
      if (!proc.stdin.write(buf)) await new Promise(function (r) { proc.stdin.once('drain', r); });
      if (i % 5 === 0) { bar.style.width = Math.round((i + 1) / n * 100) + '%'; setStatus('tstatus', (progLabel || 'Rendering') + ' · frame ' + (i + 1) + ' of ' + n); }
    }
    proc.stdin.end();
    var code = await ended;
    bar.style.width = '100%';
    if (code !== 0 || !fs.existsSync(out)) throw new Error('ffmpeg failed: ' + (errText.split('\n').filter(Boolean).pop() || 'code ' + code));
    return out;
  }
  async function readCaptionCues() {
    var sv = await jsx('ahSave()');                   // captions are read from the saved project file
    if (sv.error) throw new Error(sv.error);
    var r = PRC.readCaptions(sv.path, info.seqId);
    if (!r.tracks.length) throw new Error('This sequence has no caption track. Create captions (Text panel › Transcript › Create captions) first.');
    return r.tracks[0];
  }
  async function paintSource(quiet) {      // quiet: on tab open, never save the project by itself
    Array.prototype.forEach.call(document.querySelectorAll('#tsrc button'), function (b) { b.classList.toggle('on', b.getAttribute('data-v') === text.src); });
    $('toffrow').hidden = text.src !== 'clips';
    $('trender').textContent = text.src === 'captions' ? 'Apply to captions' : text.src === 'clips' ? 'Apply to text clips' : 'Render to timeline';
    text.preview = null; setStatus('tstatus', '');
    if (text.src === 'line' || busy) return;
    if (quiet) { setStatus('tstatus', text.src === 'captions' ? 'Captions: press Apply to read the caption track (saves the project first).' : 'Select Graphics / text clips, then Apply.'); return; }
    await refresh();
    try {
      if (text.src === 'captions') {
        if (!info.sequence) return setStatus('tstatus', 'Open the sequence with the captions.', 'warn');
        var cues = await readCaptionCues();
        text.preview = cues[0].text;
        setStatus('tstatus', cues.length + ' captions found (' + fmtT(cues[0].start) + ' – ' + fmtT(cues[cues.length - 1].end) + '). Preview shows the first one.', 'ok');
      } else {
        var r = await jsx('ahTextClips()');
        if (r.error) return setStatus('tstatus', r.error, 'warn');
        if (!r.clips.length) return setStatus('tstatus', 'Select Graphics / text clips in the timeline' + (r.selected ? ' (the ' + r.selected + ' selected have no text).' : '.'), 'warn');
        text.preview = r.clips[0].text;
        setStatus('tstatus', r.clips.length + ' text clip' + (r.clips.length > 1 ? 's' : '') + ' selected. Preview shows the first.', 'ok');
      }
    } catch (e) { setStatus('tstatus', e.message, 'bad'); }
  }
  function fmtT(s) { var m = Math.floor(s / 60), r = Math.floor(s - m * 60); return m + ':' + (r < 10 ? '0' : '') + r; }
  segValue('tsrc', function (v) { text.src = v; store('ah:tsrc', v); paintSource(); });

  $('trender').addEventListener('click', async function () {
    if (busy) return;
    await refresh();
    if (!info.sequence) { setStatus('tstatus', 'Open a sequence first; text renders at its frame size.', 'warn'); return; }
    busy = true; $('trender').disabled = true; $('tprog').hidden = false; $('tprog').firstElementChild.style.width = '0';
    try {
      if (text.src === 'line') {
        var line = lineText(), out = await renderSegs([{ start: 0, end: text.P.dur, text: line }], text.P.dur, line.split(/\s+/).slice(0, 4).join(' '));
        var r = await jsx('ahImport(' + q(out) + ',true,"Arena Text")');
        if (r.error) throw new Error(r.error);
        setStatus('tstatus', styleName() + ' rendered → Arena Text' + (r.placed ? ', on ' + r.placed + ' at the playhead' : '') + (r.note ? '. ' + r.note : ''), r.note ? 'warn' : 'ok');
      } else if (text.src === 'captions') {
        setStatus('tstatus', 'Saving and reading the captions…');
        var cues = await readCaptionCues(), t0 = cues[0].start, t1 = cues[cues.length - 1].end;
        var segs = cues.map(function (c) { return { start: c.start - t0, end: c.end - t0, text: c.text }; });
        var outC = await renderSegs(segs, t1 - t0, 'captions', cues.length + ' captions');
        var rc = await jsx('ahPlace(' + q(outC) + ',' + t0 + ',' + t1 + ',1,"Arena Text")');
        if (rc.error) throw new Error(rc.error);
        setStatus('tstatus', cues.length + ' captions styled as ' + styleName() + ' on ' + rc.placed + '. Hide the caption track (eye icon) so they don\'t double up.', 'ok');
      } else {
        var tc = await jsx('ahTextClips()');
        if (tc.error) throw new Error(tc.error);
        if (!tc.clips.length) throw new Error('Select Graphics / text clips in the timeline first.');
        var done = 0, placed = [];
        for (var i = 0; i < tc.clips.length; i++) {
          var c = tc.clips[i], d = c.end - c.start;
          var o = await renderSegs([{ start: 0, end: d, text: c.text }], d, c.text.split(/\s+/).slice(0, 4).join(' '), 'Clip ' + (i + 1) + ' of ' + tc.clips.length);
          var rp = await jsx('ahPlace(' + q(o) + ',' + c.start + ',' + c.end + ',' + (c.track + 1) + ',"Arena Text")');
          if (rp.error) throw new Error(rp.error);
          if ($('toff').checked) await evalJsx('ahDisable(' + c.track + ',' + c.index + ')');
          done++; placed.push(rp.placed);
        }
        setStatus('tstatus', done + ' text clip' + (done > 1 ? 's' : '') + ' re-styled as ' + styleName() + ' (' + placed.filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ') + ')' + ($('toff').checked ? ', originals turned off.' : '.'), 'ok');
      }
    } catch (e) { setStatus('tstatus', e.message || String(e), 'bad'); }
    busy = false; $('trender').disabled = false; setTimeout(function () { $('tprog').hidden = true; }, 800);
  });

  // ================= EFFECTS =================
  var fx = { list: readJson('catalog/effects.json').recipes || [], group: 'Trending', sel: null };
  function renderFx() {
    if (!frame.url) setFrame(sampleFrame());
    var list = fx.list.filter(function (r) { return r.group === fx.group; });
    $('fx').innerHTML = list.map(function (r) {
      var uses = (r.fx || []).map(function (f) { return f.effect; }).concat(r.keys && r.keys.length ? ['keyframes'] : []).join(' + ');
      return '<div class="card pv-' + esc(r.pv) + (fx.sel === r ? ' on' : '') + '" data-id="' + esc(r.id) + '" title="' + esc(r.desc + '\n' + uses) + '">' +
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
      el.addEventListener('input', function () { m[d[0]] = d[2] === 'range' ? +el.value : el.value; if (d[2] === 'range') el.nextSibling.textContent = el.value + '%'; store('ah:mprops', m); drawMatte($('mprev'), 160, 160 * frameWH()[1] / frameWH()[0]); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('.seg'), function (sg) {
      var d = MPROPS[tools.mtype][+sg.getAttribute('data-i')];
      Array.prototype.forEach.call(sg.querySelectorAll('button'), function (b) { b.addEventListener('click', function () { m[d[0]] = b.getAttribute('data-v'); store('ah:mprops', m); renderMatteProps(); }); });
    });
    var wh = frameWH(), pv = $('mprev'); pv.width = 160; pv.height = Math.round(160 * wh[1] / wh[0]);
    drawMatte(pv, pv.width, pv.height);
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
