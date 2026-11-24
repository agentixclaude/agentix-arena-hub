/* Caption lines for the Text tab: read SRT / VTT, re-chunk into one-line captions, write SRT.
   Pure functions, no Premiere calls. Times are seconds. */
'use strict';

function toSec(ts) {
  var m = String(ts).trim().replace(',', '.').match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (!m) return NaN;
  return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (m[4] ? +('0.' + m[4]) : 0);
}
function cleanText(s) {
  return String(s)
    .replace(/<[^>]+>/g, '')                  // <i>, <b>, <font>, VTT <c.x> / <00:00:01.000>
    .replace(/\{\\[^}]*\}/g, '')              // {\an8} positioning tags
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

// SRT or WebVTT -> [{start, end, text}], sorted, empty cues dropped
function parse(src) {
  var lines = String(src).replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n'), out = [], cur = null;
  var arrow = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i], m = L.match(arrow);
    if (m) {
      if (cur) out.push(cur);
      cur = { start: toSec(m[1]), end: toSec(m[2]), text: [] };
      continue;
    }
    if (!cur) continue;
    if (!L.trim()) { out.push(cur); cur = null; continue; }
    if (/^\d+$/.test(L.trim()) && lines[i + 1] && arrow.test(lines[i + 1])) continue;   // stray index line
    cur.text.push(L);
  }
  if (cur) out.push(cur);
  return out.map(function (c) { return { start: c.start, end: c.end, text: cleanText(c.text.join(' ')) }; })
    .filter(function (c) { return c.text && isFinite(c.start) && isFinite(c.end) && c.end > c.start; })
    .sort(function (a, b) { return a.start - b.start; });
}

// One-line chunks. opts: maxWords, maxChars, upper, dropPunct
function chunk(cues, opts) {
  var o = Object.assign({ maxWords: 4, maxChars: 28, upper: false, dropPunct: false }, opts || {}), out = [];
  cues.forEach(function (c) {
    var words = c.text.split(/\s+/).filter(Boolean);
    if (!words.length) return;
    var groups = [], g = [];
    words.forEach(function (w) {
      var len = g.join(' ').length + (g.length ? 1 : 0) + w.length;
      if (g.length && (g.length >= o.maxWords || len > o.maxChars)) { groups.push(g); g = []; }
      g.push(w);
    });
    if (g.length) groups.push(g);
    // no single-word orphan at the end when the line before can give one away
    var n = groups.length;
    if (n > 1 && groups[n - 1].length === 1 && groups[n - 2].length > 2) groups[n - 1].unshift(groups[n - 2].pop());
    // time split by characters spoken
    var weight = function (gr) { return gr.join(' ').length + 1; };
    var total = groups.reduce(function (s, gr) { return s + weight(gr); }, 0), t = c.start, span = c.end - c.start;
    groups.forEach(function (gr, i) {
      var end = i === groups.length - 1 ? c.end : t + span * weight(gr) / total;
      var txt = gr.join(' ');
      if (o.dropPunct) txt = txt.replace(/[,.;:]+(?=\s|$)/g, '').replace(/\s+/g, ' ').trim();
      if (o.upper) txt = txt.toUpperCase();
      if (txt) out.push({ start: round3(t), end: round3(end), text: txt });
      t = end;
    });
  });
  return out;
}
function round3(x) { return Math.round(x * 1000) / 1000; }

function stamp(sec) {
  var ms = Math.max(0, Math.round(sec * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  var p = function (n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; };
  return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + ',' + p(r, 3);
}
function toSrt(lines, offset) {
  var off = offset || 0;
  return lines.map(function (l, i) { return (i + 1) + '\n' + stamp(l.start + off) + ' --> ' + stamp(l.end + off) + '\n' + l.text + '\n'; }).join('\n');
}

module.exports = { parse: parse, chunk: chunk, toSrt: toSrt, toSec: toSec };
