/* Arena Hub — caption renderer. One pure function draw(ctx, W, H, t, styleId, text, P) drives the cards,
   the big preview and the transparent ProRes 4444 render, so what you see is what lands on the timeline. */
(function (root) {
  'use strict';

  var STYLES = [
    { id: 'rise',      name: 'Word Rise',     desc: 'Words rise in, 2 frames apart',          box: false },
    { id: 'pop',       name: 'Pop',           desc: 'Each word pops with a small overshoot',  box: false },
    { id: 'blur',      name: 'Focus In',      desc: 'Words sharpen out of a blur',            box: false },
    { id: 'mask',      name: 'Mask Reveal',   desc: 'Lines slide up out of a hard mask',      box: false },
    { id: 'type',      name: 'Type On',       desc: 'Characters type on with a caret',        box: false },
    { id: 'karaoke',   name: 'Highlight',     desc: 'Spoken word lights up in the accent',    box: false },
    { id: 'hlbox',     name: 'Highlight Box', desc: 'Accent box jumps word to word',          box: false },
    { id: 'word',      name: 'One Word',      desc: 'One big word at a time',                 box: false },
    { id: 'underline', name: 'Underline',     desc: 'Accent bar sweeps under the line',       box: false },
    { id: 'outline',   name: 'Outline Fill',  desc: 'Outline, then the fill wipes in',        box: false },
    { id: 'boxline',   name: 'Box Line',      desc: 'Solid box wipes in behind each line',    box: true },
    { id: 'pill',      name: 'Pill',          desc: 'Rounded pill pops in behind each line',  box: true },
    { id: 'boxword',   name: 'Box Words',     desc: 'Every word in its own box',              box: true }
  ];

  var DEFAULTS = {
    font: 'Montserrat', weight: 800, size: 6.5, upper: false, color: '#ffffff', accent: '#ffd23f', onAccent: '#111111',
    boxColor: '#111111', boxAlpha: 85, radius: 18, pad: 30, stroke: 0, strokeColor: '#000000', shadow: true,
    posY: 72, align: 'center', maxW: 84, speed: 0.067, dur: 3, lineGap: 1.18
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function outQuart(p) { p = clamp(p, 0, 1); return 1 - Math.pow(1 - p, 4); }
  function outBack(p) { p = clamp(p, 0, 1); var c = 1.9; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
  function hexA(hex, a) {
    var h = String(hex).replace('#', ''); if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h, 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fontStr(P, px) { return P.weight + ' ' + Math.round(px) + 'px "' + P.font + '", "Montserrat", -apple-system, sans-serif'; }

  // ---- layout: wrap words into lines inside maxW, block centred on posY ----
  function layout(ctx, W, H, text, P, scale) {
    var px = P.size / 100 * Math.min(W, H) * (scale || 1);
    ctx.font = fontStr(P, px);
    var raw = String(text || '').replace(/\r/g, '');
    if (P.upper) raw = raw.toUpperCase();
    var maxW = P.maxW / 100 * W, space = ctx.measureText(' ').width, lineH = px * P.lineGap;
    var lines = [], gi = 0;
    raw.split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), cur = null;
      words.forEach(function (w) {
        var ww = ctx.measureText(w).width;
        if (!cur || (cur.width + space + ww > maxW && cur.words.length)) { cur = { words: [], width: 0 }; lines.push(cur); }
        cur.words.push({ t: w, w: ww, i: gi++ });
        cur.width += (cur.words.length > 1 ? space : 0) + ww;
      });
    });
    var top = P.posY / 100 * H - (lines.length * lineH) / 2;
    var left = (W - maxW) / 2;
    lines.forEach(function (ln, j) {
      ln.y = top + j * lineH + lineH / 2;
      var x = P.align === 'left' ? left : (W - ln.width) / 2;
      ln.x = x;
      ln.words.forEach(function (w) { w.x = x; w.y = ln.y; x += w.w + space; });
    });
    return { lines: lines, n: gi, px: px, lineH: lineH, space: space };
  }

  function shadowOn(ctx, P, px) { if (P.shadow) { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = px * 0.14; ctx.shadowOffsetY = px * 0.04; } }
  function shadowOff(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }
  function word(ctx, P, L, w, o) {
    o = o || {};
    var a = o.alpha === undefined ? 1 : o.alpha; if (a <= 0.001) return;
    ctx.save();
    ctx.globalAlpha *= a;
    var cx = w.x + w.w / 2, cy = w.y + (o.dy || 0);
    ctx.translate(cx, cy);
    if (o.scale && o.scale !== 1) ctx.scale(o.scale, o.scale);
    if (o.blur) ctx.filter = 'blur(' + o.blur.toFixed(1) + 'px)';
    ctx.font = fontStr(P, L.px); ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    if (P.stroke > 0 || o.strokeOnly) {
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, (o.strokeOnly ? Math.max(P.stroke, 4) : P.stroke) / 100 * L.px * 2);
      ctx.strokeStyle = o.strokeOnly ? (o.color || P.color) : P.strokeColor;
      shadowOn(ctx, P, L.px); ctx.strokeText(w.t, 0, 0); shadowOff(ctx);
    }
    if (!o.strokeOnly) {
      if (!(P.stroke > 0)) shadowOn(ctx, P, L.px);
      ctx.fillStyle = o.color || P.color; ctx.fillText(w.t, 0, 0);
    }
    ctx.restore();
  }
  function boxFor(L, P, x0, x1, y) { var pad = P.pad / 100 * L.px, h = L.px * 1.12 + pad * 0.6; return { x: x0 - pad, y: y - h / 2, w: x1 - x0 + pad * 2, h: h }; }
  function fill(ctx, color, alpha) { ctx.fillStyle = hexA(color, alpha); ctx.fill(); }

  function draw(ctx, W, H, t, id, text, P, opt) {
    opt = opt || {};
    var L = opt.layout || layout(ctx, W, H, text, P, opt.scale);
    if (!L.n) return L;
    var dur = Math.max(0.5, P.dur), sp = P.speed;
    var out = t > dur - 0.3 ? clamp((dur - t) / 0.3, 0, 1) : 1;      // shared 0.3 s fade-out
    ctx.save(); ctx.globalAlpha = out;
    var words = []; L.lines.forEach(function (ln) { ln.words.forEach(function (w) { words.push(w); }); });
    var wd = Math.max(0.12, (dur - 0.6) / L.n), active = clamp(Math.floor((t - 0.15) / wd), 0, L.n - 1);
    var p, e;

    switch (id) {
      case 'rise':
        words.forEach(function (w) { p = (t - w.i * sp) / 0.45; e = outQuart(p); word(ctx, P, L, w, { alpha: clamp(p * 2.2, 0, 1), dy: (1 - e) * L.lineH * 0.55 }); });
        break;
      case 'pop':
        words.forEach(function (w) { p = (t - w.i * sp * 1.4) / 0.38; word(ctx, P, L, w, { alpha: clamp(p * 4, 0, 1), scale: 0.88 + 0.12 * outBack(p) }); });
        break;
      case 'blur':
        words.forEach(function (w) { p = (t - w.i * sp * 1.2) / 0.5; e = outQuart(p); word(ctx, P, L, w, { alpha: clamp(p * 1.6, 0, 1), blur: (1 - e) * L.px * 0.22 }); });
        break;
      case 'mask':
        L.lines.forEach(function (ln, j) {
          e = outQuart((t - j * 0.12) / 0.55);
          ctx.save(); ctx.beginPath(); ctx.rect(0, ln.y - L.lineH / 2, W, L.lineH); ctx.clip();
          ln.words.forEach(function (w) { word(ctx, P, L, w, { dy: (1 - e) * L.lineH }); });
          ctx.restore();
        });
        break;
      case 'type': {
        var total = 0; L.lines.forEach(function (ln) { ln.str = ln.words.map(function (w) { return w.t; }).join(' '); total += ln.str.length; });
        var ct = Math.min(0.055, (dur * 0.55) / Math.max(1, total)), shown = Math.floor(t / ct), caret = null;
        ctx.font = fontStr(P, L.px); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        L.lines.forEach(function (ln) {
          if (shown <= 0) return;
          var s = ln.str.slice(0, shown); shown -= ln.str.length;
          var x = P.align === 'left' ? ln.x : (W - ln.width) / 2;
          if (P.stroke > 0) { ctx.lineJoin = 'round'; ctx.lineWidth = P.stroke / 100 * L.px * 2; ctx.strokeStyle = P.strokeColor; shadowOn(ctx, P, L.px); ctx.strokeText(s, x, ln.y); shadowOff(ctx); }
          else shadowOn(ctx, P, L.px);
          ctx.fillStyle = P.color; ctx.fillText(s, x, ln.y); shadowOff(ctx);
          caret = { x: x + ctx.measureText(s).width, y: ln.y };
        });
        var typing = t < total * ct;
        if (caret && (typing || Math.floor(t * 2.2) % 2 === 0)) { ctx.fillStyle = P.accent; ctx.fillRect(caret.x + L.px * 0.06, caret.y - L.px * 0.5, Math.max(2, L.px * 0.07), L.px); }
        break;
      }
      case 'karaoke':
        words.forEach(function (w) {
          p = t / 0.3; var on = w.i === active, done = w.i < active;
          word(ctx, P, L, w, { alpha: clamp(p, 0, 1), color: on ? P.accent : done ? P.color : hexA(P.color, 0.55), scale: on ? 1.06 : 1 });
        });
        break;
      case 'hlbox': {
        var a = words[active], prev = words[Math.max(0, active - 1)], k = outQuart(((t - 0.15) - active * wd) / 0.16);
        var bx = function (w) { return boxFor(L, P, w.x, w.x + w.w, w.y); };
        var A = bx(a), B = active ? bx(prev) : A;
        var lerp = function (u, v) { return v + (u - v) * k; };
        ctx.save(); ctx.globalAlpha *= clamp(t / 0.25, 0, 1);
        rrect(ctx, lerp(A.x, B.x), lerp(A.y, B.y), lerp(A.w, B.w), lerp(A.h, B.h), P.radius / 100 * A.h); fill(ctx, P.accent, 1);
        ctx.restore();
        words.forEach(function (w) { word(ctx, P, L, w, { alpha: clamp(t / 0.25, 0, 1), color: w === a ? P.onAccent : P.color }); });
        break;
      }
      case 'word': {
        var w0 = words[active], big = layout(ctx, W, H, w0.t, P, 1.55), ww = big.lines[0].words[0];
        p = ((t - 0.15) - active * wd) / 0.3;
        word(ctx, P, big, ww, { alpha: clamp(p * 4, 0, 1), scale: 0.86 + 0.14 * outBack(p) });
        break;
      }
      case 'underline':
        words.forEach(function (w) { p = (t - w.i * sp * 0.6) / 0.4; word(ctx, P, L, w, { alpha: clamp(p * 2, 0, 1), dy: (1 - outQuart(p)) * L.px * 0.3 }); });
        L.lines.forEach(function (ln, j) {
          e = outQuart((t - 0.3 - j * 0.12) / 0.5);
          var x0 = ln.words[0].x, x1 = x0 + ln.width, th = Math.max(3, L.px * 0.09);
          ctx.fillStyle = P.accent; ctx.fillRect(x0, ln.y + L.px * 0.58, (x1 - x0) * e, th);
        });
        break;
      case 'outline': {
        words.forEach(function (w) { word(ctx, P, L, w, { alpha: clamp(t / 0.3, 0, 1), strokeOnly: true }); });
        var x0 = Math.min.apply(null, L.lines.map(function (l) { return l.words[0].x; })), x1 = Math.max.apply(null, L.lines.map(function (l) { return l.words[0].x + l.width; }));
        e = outQuart((t - 0.35) / 0.8);
        ctx.save(); ctx.beginPath(); ctx.rect(x0 - L.px, 0, (x1 - x0 + L.px * 2) * e, H); ctx.clip();
        words.forEach(function (w) { word(ctx, P, L, w, {}); });
        ctx.restore();
        break;
      }
      case 'boxline':
        L.lines.forEach(function (ln, j) {
          var b = boxFor(L, P, ln.words[0].x, ln.words[0].x + ln.width, ln.y);
          e = outQuart((t - j * 0.12) / 0.4);
          ctx.save(); rrect(ctx, b.x, b.y, b.w * e, b.h, P.radius / 100 * b.h); fill(ctx, P.boxColor, P.boxAlpha / 100); ctx.restore();
          var pt = (t - 0.18 - j * 0.12) / 0.4;
          ln.words.forEach(function (w) { word(ctx, P, L, w, { alpha: clamp(pt * 2, 0, 1), dy: (1 - outQuart(pt)) * L.px * 0.25 }); });
        });
        break;
      case 'pill':
        L.lines.forEach(function (ln, j) {
          var b = boxFor(L, P, ln.words[0].x, ln.words[0].x + ln.width, ln.y);
          p = (t - j * 0.1) / 0.4; var s = 0.85 + 0.15 * outBack(p);
          ctx.save(); ctx.globalAlpha *= clamp(p * 3, 0, 1);
          ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(s, s); ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
          rrect(ctx, b.x, b.y, b.w, b.h, b.h / 2); fill(ctx, P.boxColor, P.boxAlpha / 100);
          ln.words.forEach(function (w) { word(ctx, P, L, w, {}); });
          ctx.restore();
        });
        break;
      case 'boxword':
        words.forEach(function (w) {
          p = (t - w.i * sp * 1.5) / 0.35; var s = 0.8 + 0.2 * outBack(p), b = boxFor(L, P, w.x, w.x + w.w, w.y);
          var padX = Math.min(P.pad / 100 * L.px, L.space * 0.38);      // keep a visible gap between word boxes
          b.x = w.x - padX; b.w = w.w + padX * 2;
          ctx.save(); ctx.globalAlpha *= clamp(p * 3, 0, 1);
          ctx.translate(b.x + b.w / 2, b.y + b.h / 2); ctx.scale(s, s); ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
          rrect(ctx, b.x, b.y, b.w, b.h, P.radius / 100 * b.h); fill(ctx, w.i === active ? P.accent : P.boxColor, w.i === active ? 1 : P.boxAlpha / 100);
          word(ctx, P, L, w, { color: w.i === active ? P.onAccent : P.color });
          ctx.restore();
        });
        break;
    }
    ctx.restore();
    return L;
  }

  root.TXF = { STYLES: STYLES, DEFAULTS: DEFAULTS, draw: draw, layout: layout };
})(window);
