/* Read a sequence's caption track straight from the saved .prproj (Premiere's scripting API cannot read captions).
   Captions live in <CaptionDataClipTrack> → <CaptionDataClipTrackItem> (Start/End ticks) → <Block><FormattedTextData base64>,
   a FlatBuffer whose last length-prefixed UTF-8 string is the caption text. */
'use strict';
var fs = require('fs'), zlib = require('zlib');
var TICKS = 254016000000;

function loadXml(prproj) {
  var buf = fs.readFileSync(prproj);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  return buf.toString('utf8');
}
function indexObjects(xml) {
  var idx = {}, re = /<(\w+) Object(U?)ID="([^"]+)"/g, m;
  while ((m = re.exec(xml))) idx[m[3]] = { name: m[1], start: m.index };
  return idx;
}
function body(xml, o) { if (!o) return ''; var end = xml.indexOf('</' + o.name + '>', o.start); return end < 0 ? '' : xml.slice(o.start, end); }
function refs(s) { var out = [], re = /Object(?:U)?Ref="([^"]+)"/g, m; while ((m = re.exec(s))) out.push(m[1]); return out; }
function flatText(b64) {
  var b = Buffer.from(b64.replace(/\s+/g, ''), 'base64'), best = null;
  for (var i = 0; i + 4 < b.length; i++) {
    var L = b.readUInt32LE(i);
    if (L < 1 || L > 4000 || i + 4 + L > b.length) continue;
    if (i + 4 + L < b.length && b[i + 4 + L] !== 0) continue;
    var s = b.slice(i + 4, i + 4 + L).toString('utf8');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f�]/.test(s)) continue;
    best = s;                                  // keep the last valid string: font names come first, the text last
  }
  return best;
}
function trackCues(xml, idx, trackBody) {
  var cues = [];
  var items = trackBody.match(/<TrackItem Index="\d+" ObjectRef="[^"]+"\/>/g) || [];
  items.forEach(function (tag) {
    var id = tag.match(/ObjectRef="([^"]+)"/)[1], it = body(xml, idx[id]);
    if (!it || idx[id].name !== 'CaptionDataClipTrackItem') return;
    var st = it.match(/<Start>(-?\d+)<\/Start>/), en = it.match(/<End>(-?\d+)<\/End>/);
    var texts = [];
    (it.match(/<BlockVectorItem Index="\d+" ObjectRef="[^"]+"\/>/g) || []).forEach(function (bt) {
      var blk = body(xml, idx[bt.match(/ObjectRef="([^"]+)"/)[1]]), d = blk.match(/<FormattedTextData[^>]*>([\s\S]*?)<\/FormattedTextData>/);
      if (d) { var t = flatText(d[1]); if (t) texts.push(t); }
    });
    var text = texts.join('\n').replace(/\r\n?/g, '\n').trim();
    if (!text || !en) return;
    cues.push({ start: (st ? +st[1] : 0) / TICKS, end: +en[1] / TICKS, text: text });
  });
  return cues.sort(function (a, b) { return a.start - b.start; });
}
// cues of the caption track(s) that belong to sequence `seqId` (every caption track when the sequence is not in the file)
function readCaptions(prproj, seqId) {
  var xml = loadXml(prproj), idx = indexObjects(xml);
  var capTracks = Object.keys(idx).filter(function (k) { return idx[k].name === 'CaptionDataClipTrack'; });
  if (!capTracks.length) return { tracks: [] };
  var mine = capTracks;
  var seq = seqId && idx[seqId];
  if (seq) {
    var seen = {}, frontier = [seqId];
    for (var depth = 0; depth < 3; depth++) {
      var next = [];
      frontier.forEach(function (id) { refs(body(xml, idx[id])).forEach(function (r) { if (!seen[r]) { seen[r] = 1; next.push(r); } }); });
      frontier = next.filter(function (r) { return idx[r] && /TrackGroup|Track$/.test(idx[r].name); });
    }
    mine = capTracks.filter(function (k) { return seen[k]; });       // only this sequence's own caption tracks
  }
  return { tracks: mine.map(function (k) { return trackCues(xml, idx, body(xml, idx[k])); }).filter(function (c) { return c.length; }) };
}
module.exports = { readCaptions: readCaptions, flatText: flatText };
