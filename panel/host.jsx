/* Agentix Arena Hub — ExtendScript host. All functions return JSON or "OK"/"ERR:..." strings. */
function ahEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' '); }
function ahErr(e) { return '{"error":"' + ahEsc(e && e.toString ? e.toString() : e) + '"}'; }

function ahInfo() {
    try {
        var p = app.project;
        if (!p || !p.path) { return '{"open":false}'; }
        var s = p.activeSequence, sel = s ? ahSelected(s).length : 0, w = 0, h = 0, fr = 0;
        if (s) { try { w = s.frameSizeHorizontal; h = s.frameSizeVertical; fr = s.getSettings().videoFrameRate.seconds; } catch (e1) {} }
        return '{"open":true,"project":"' + ahEsc(p.name) + '","path":"' + ahEsc(p.path) + '","seqId":"' + (s ? ahEsc(s.sequenceID) : '') + '","sequence":"' + (s ? ahEsc(s.name) : '') + '","selected":' + sel +
            ',"playhead":' + (s ? s.getPlayerPosition().seconds : 0) + ',"width":' + (w || 0) + ',"height":' + (h || 0) + ',"frame":' + (fr || 0) + '}';
    } catch (e) { return ahErr(e); }
}

/* selected video clips on every track: [{clip, track, index}] */
function ahSelected(s) {
    var out = [];
    for (var t = 0; t < s.videoTracks.numTracks; t++) {
        var tr = s.videoTracks[t];
        for (var j = 0; j < tr.clips.numItems; j++) {
            var c = tr.clips[j], on = false;
            try { on = c.isSelected(); } catch (e) {}
            if (on) { out.push({ clip: c, track: t, index: j }); }
        }
    }
    return out;
}
function ahComp(clip, name) {
    for (var i = 0; i < clip.components.numItems; i++) { if (clip.components[i].displayName === name) { return clip.components[i]; } }
    return null;
}
function ahLastComp(clip, name) {
    for (var i = clip.components.numItems - 1; i >= 0; i--) { if (clip.components[i].displayName === name) { return clip.components[i]; } }
    return null;
}
function ahProp(comp, name) {
    if (!comp) { return null; }
    for (var i = 0; i < comp.properties.numItems; i++) { if (comp.properties[i].displayName === name) { return comp.properties[i]; } }
    return null;
}
function ahQeItem(track, index) {
    app.enableQE();
    var qt = qe.project.getActiveSequence().getVideoTrackAt(track), n = -1;
    for (var i = 0; i < qt.numItems; i++) {
        var it = qt.getItemAt(i);
        if (it.type === 'Empty') { continue; }
        n++;
        if (n === index) { return it; }
    }
    return null;
}

/* ---------- Drop: import files into the "Arena Drops" bin, optionally overwrite at the playhead ---------- */
function ahBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c.type === ProjectItemType.BIN && c.name === name) { return c; }
    }
    return root.createBin(name);
}
function ahFindIn(bin, filePath) {
    var want = String(filePath).toLowerCase();
    for (var i = bin.children.numItems - 1; i >= 0; i--) {
        var c = bin.children[i], mp = '';
        try { mp = String(c.getMediaPath()).toLowerCase(); } catch (e) {}
        if (mp === want) { return c; }
    }
    return null;
}
function ahFreeTrack(s, seconds, from) {
    for (var t = from; t < s.videoTracks.numTracks; t++) {
        var tr = s.videoTracks[t], busy = false;
        for (var j = 0; j < tr.clips.numItems; j++) {
            var c = tr.clips[j];
            if (c.start.seconds <= seconds + 0.001 && c.end.seconds > seconds + 0.001) { busy = true; break; }
        }
        if (!busy) { return t; }
    }
    return -1;
}
function ahImport(filePath, insert, binName) {
    try {
        if (!app.project || !app.project.path) { return '{"error":"Open a project first."}'; }
        var bin = ahBin(binName || 'Arena Drops'), item = ahFindIn(bin, filePath);
        if (!item) {
            if (!app.project.importFiles([filePath], true, bin, false)) { return '{"error":"Premiere could not import this file."}'; }
            item = ahFindIn(bin, filePath);
        }
        if (!item) { return '{"error":"Imported, but the item was not found in the bin."}'; }
        var placed = '';
        if (insert) {
            var s = app.project.activeSequence;
            if (!s) { return '{"ok":true,"name":"' + ahEsc(item.name) + '","placed":"","note":"No sequence open, kept in the bin."}'; }
            var at = s.getPlayerPosition().seconds, t = ahFreeTrack(s, at, 1);
            if (t < 0) { t = ahFreeTrack(s, at, 0); }
            if (t < 0) { return '{"ok":true,"name":"' + ahEsc(item.name) + '","placed":"","note":"Every video track is busy at the playhead. Add a track."}'; }
            s.videoTracks[t].overwriteClip(item, at);
            placed = 'V' + (t + 1);
        }
        return '{"ok":true,"name":"' + ahEsc(item.name) + '","placed":"' + placed + '"}';
    } catch (e) { return ahErr(e); }
}

/* ---------- Templates / Text: drop a .mogrt at the playhead ---------- */
function ahMogrt(filePath, text) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var pos = s.getPlayerPosition(), t = ahFreeTrack(s, pos.seconds, 1);
        if (t < 0) { t = s.videoTracks.numTracks - 1; }
        var item = s.importMGT(filePath, pos.ticks, t, 0);
        if (!item) { return '{"error":"Premiere refused this template."}'; }
        var set = false;
        if (text) {
            try {
                var m = item.getMGTComponent();
                for (var i = 0; m && i < m.properties.numItems && !set; i++) {
                    var pr = m.properties[i], v = '';
                    try { v = String(pr.getValue()); } catch (e1) {}
                    if (/text|title|name|line/i.test(pr.displayName) || v.indexOf('"textEditValue"') >= 0) {
                        if (v.indexOf('"textEditValue"') >= 0) {
                            var o = eval('(' + v + ')'); o.textEditValue = text;
                            pr.setValue(ahJson(o), true);
                        } else { pr.setValue(text, true); }
                        set = true;
                    }
                }
            } catch (e2) {}
        }
        return '{"ok":true,"name":"' + ahEsc(item.name) + '","track":"V' + (t + 1) + '","text":' + set + '}';
    } catch (e) { return ahErr(e); }
}
function ahJson(o) {
    if (o === null) { return 'null'; }
    if (o instanceof Array) { var a = []; for (var i = 0; i < o.length; i++) { a.push(ahJson(o[i])); } return '[' + a.join(',') + ']'; }
    if (typeof o === 'object') { var r = []; for (var k in o) { if (o.hasOwnProperty(k)) { r.push('"' + ahEsc(k) + '":' + ahJson(o[k])); } } return '{' + r.join(',') + '}'; }
    if (typeof o === 'string') { return '"' + ahEsc(o) + '"'; }
    return String(o);
}

/* ---------- keyframes: at = seconds from clip start, or 'end' / 'end-0.4'. interp: 'linear' | 'hold' | default bezier ---------- */
var AH_INTERP = { linear: 0, hold: 4, bezier: 5 };
function ahKeys(c, keys, frame, compFor, miss) {
    var tin = c.inPoint.seconds, tout = c.outPoint.seconds - frame, cleared = {};
    for (var k = 0; k < keys.length; k++) {
        var key = keys[k], pr = ahProp(compFor(key.comp), key.prop);
        if (!pr) { miss[key.comp + ' ' + key.prop] = 1; continue; }
        var at = key.at, t;
        if (typeof at === 'number') { t = tin + at; }
        else { var m = String(at).match(/^end(?:-([\d.]+))?$/); t = tout - (m && m[1] ? parseFloat(m[1]) : 0); }
        if (t > tout) { t = tout; }
        if (t < tin) { t = tin; }
        var id = key.comp + '/' + key.prop;
        try {
            if (!cleared[id]) { try { pr.setTimeVarying(false); } catch (e1) {} pr.setTimeVarying(true); cleared[id] = 1; }
            pr.addKey(t);
            pr.setValueAtKey(t, key.v, true);
            try { pr.setInterpolationTypeAtKey(t, AH_INTERP[key.interp || 'bezier'], true); } catch (e2) {}
        } catch (e3) { miss[key.comp + ' ' + key.prop] = 1; }
    }
}
function ahFrameSec(s) { var f = 1 / 30; try { f = s.getSettings().videoFrameRate.seconds || f; } catch (e) {} return f; }
function ahMissList(miss) { var m2 = []; for (var x in miss) { if (miss.hasOwnProperty(x)) { m2.push('"' + ahEsc(x) + '"'); } } return '[' + m2.join(',') + ']'; }

/* ---------- Motion: keyframe presets on the selected clips ---------- */
function ahMotion(presetJson) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var preset = eval('(' + presetJson + ')'), sel = ahSelected(s);
        if (!sel.length) { return '{"error":"Select one or more clips in the timeline."}'; }
        var frame = ahFrameSec(s), miss = {};
        for (var i = 0; i < sel.length; i++) {
            var c = sel[i].clip;
            ahKeys(c, preset.keys, frame, function (name) { return ahComp(c, name); }, miss);
        }
        return '{"ok":true,"clips":' + sel.length + ',"missing":' + ahMissList(miss) + '}';
    } catch (e) { return ahErr(e); }
}

/* ---------- Effects: one or more effects + values + optional keyframes ---------- */
// targets: [{clip, track, index}]
function ahApplyRecipe(r, targets, s) {
    app.enableQE();
    var list = r.fx || [], frame = ahFrameSec(s), done = 0, miss = {}, i, f, qfx = [];
    for (f = 0; f < list.length; f++) {
        var q = qe.project.getVideoEffectByName(list[f].effect);
        if (!q) { return { error: 'This Premiere has no effect called ' + list[f].effect + '.' }; }
        qfx.push(q);
    }
    for (i = 0; i < targets.length; i++) {
        var c = targets[i].clip, it = ahQeItem(targets[i].track, targets[i].index);
        if (!it) { continue; }
        for (f = 0; f < list.length; f++) {
            it.addVideoEffect(qfx[f]);
            var comp = ahLastComp(c, list[f].effect);
            if (!comp) { miss[list[f].effect] = 1; continue; }
            for (var name in list[f].props) {
                if (!list[f].props.hasOwnProperty(name)) { continue; }
                var pr = ahProp(comp, name);
                if (!pr) { miss[list[f].effect + ' ' + name] = 1; continue; }
                try { pr.setValue(list[f].props[name], true); } catch (e1) { miss[list[f].effect + ' ' + name] = 1; }
            }
        }
        if (r.keys && r.keys.length) { ahKeys(c, r.keys, frame, function (name) { return name === 'Motion' || name === 'Opacity' ? ahComp(c, name) : ahLastComp(c, name); }, miss); }
        done++;
    }
    return { clips: done, miss: miss };
}
function ahEffect(recipeJson) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var r = eval('(' + recipeJson + ')'), sel = ahSelected(s);
        if (!sel.length) { return '{"error":"Select one or more clips in the timeline."}'; }
        var res = ahApplyRecipe(r, sel, s);
        if (res.error) { return '{"error":"' + ahEsc(res.error) + '"}'; }
        return '{"ok":true,"clips":' + res.clips + ',"missing":' + ahMissList(res.miss) + '}';
    } catch (e) { return ahErr(e); }
}

/* ---------- the frame under the playhead as PNG (previews) ---------- */
function ahFrame(outBase) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return 'ERR:no sequence'; }
        app.enableQE();
        var q = qe.project.getActiveSequence();
        if (typeof q.exportFramePNG === 'function') { q.exportFramePNG(q.CTI.timecode, outBase); return 'OK:png'; }
        q.exportFrameJPEG(q.CTI.timecode, outBase);
        return 'OK:jpg';
    } catch (e) { return 'ERR:' + e.toString(); }
}

/* ---------- Text tab: save, place renders over a time range, read Graphics text clips ---------- */
function ahSave() {
    try { if (!app.project || !app.project.path) { return '{"error":"Open a project first."}'; } app.project.save(); return '{"ok":true,"path":"' + ahEsc(app.project.path) + '"}'; }
    catch (e) { return ahErr(e); }
}
function ahRangeFree(tr, a, b) {
    for (var j = 0; j < tr.clips.numItems; j++) { var c = tr.clips[j]; if (c.start.seconds < b - 0.001 && c.end.seconds > a + 0.001) { return false; } }
    return true;
}
/* ---------- Tools: smart place over the selected section (adjustment layers, mattes, overlays) ----------
   Range = sequence In/Out, or the selected clips (one range over all, or one per clip).
   Track = first video track above the selected clips that is empty across the whole range; adds a track when all are busy. */
function ahT(sec) { var t = new Time(); t.seconds = sec; return t; }
function ahRanges(source, perClip) {
    var s = app.project.activeSequence, out = [], i;
    if (!s) { return { error: 'Open a sequence first.' }; }
    if (source === 'inout') {
        var a = parseFloat(s.getInPoint()), b = parseFloat(s.getOutPoint());
        if (!(b > a) || b - a > 36000) { return { error: 'Set In and Out points on the sequence first (I / O).' }; }
        return { ranges: [{ start: a, end: b, minTrack: 1 }] };
    }
    var sel = ahSelected(s);
    if (!sel.length) { return { error: 'Select the clips that mark the section.' }; }
    if (perClip) {
        for (i = 0; i < sel.length; i++) { out.push({ start: sel[i].clip.start.seconds, end: sel[i].clip.end.seconds, minTrack: sel[i].track + 1 }); }
        return { ranges: out };
    }
    var st = 1e9, en = 0, top = 0;
    for (i = 0; i < sel.length; i++) { st = Math.min(st, sel[i].clip.start.seconds); en = Math.max(en, sel[i].clip.end.seconds); top = Math.max(top, sel[i].track); }
    return { ranges: [{ start: st, end: en, minTrack: top + 1 }] };
}
function ahRangeInfo(source, perClip) {
    try {
        var r = ahRanges(source, perClip === 'true' || perClip === true);
        if (r.error) { return '{"error":"' + ahEsc(r.error) + '"}'; }
        var s = app.project.activeSequence, parts = [];
        for (var i = 0; i < r.ranges.length; i++) {
            var g = r.ranges[i], t = -1;
            for (var k = g.minTrack; k < s.videoTracks.numTracks; k++) { if (ahRangeFree(s.videoTracks[k], g.start, g.end)) { t = k; break; } }
            parts.push('{"start":' + g.start + ',"end":' + g.end + ',"track":' + t + '}');
        }
        return '{"ranges":[' + parts.join(',') + ']}';
    } catch (e) { return ahErr(e); }
}
function ahWalk(item, fn) {
    for (var i = 0; i < item.children.numItems; i++) {
        var c = item.children[i];
        if (c.type === ProjectItemType.BIN) { if (ahWalk(c, fn)) { return true; } } else if (fn(c)) { return true; }
    }
    return false;
}
function ahAdjustItem(templatePath) {
    var found = null;
    ahWalk(app.project.rootItem, function (c) { try { if (c.isAdjustmentLayer()) { found = c; return true; } } catch (e) {} return false; });
    if (found) { return found; }
    if (templatePath && new File(templatePath).exists) {      // one-time: bring the adjustment layer in from Arena's template project
        var bin = ahBin('Arena Tools');
        app.project.importFiles([templatePath], true, bin, false);
        ahWalk(bin, function (c) { try { if (c.isAdjustmentLayer()) { found = c; return true; } } catch (e) {} return false; });
    }
    return found;
}
// place `item` over each range; returns placed track items
function ahPlaceRanges(item, ranges, isStill) {
    var s = app.project.activeSequence, placed = [], notes = [];
    for (var i = 0; i < ranges.length; i++) {
        var g = ranges[i], t = -1, k;
        for (k = Math.max(0, g.minTrack); k < s.videoTracks.numTracks; k++) { if (ahRangeFree(s.videoTracks[k], g.start, g.end)) { t = k; break; } }
        if (t < 0) {
            try { app.enableQE(); qe.project.getActiveSequence().addTracks(1, s.videoTracks.numTracks, 0); } catch (e1) {}
            s = app.project.activeSequence; k = s.videoTracks.numTracks - 1;
            if (k >= g.minTrack && ahRangeFree(s.videoTracks[k], g.start, g.end)) { t = k; }
        }
        if (t < 0) { notes.push('no free track at ' + Math.round(g.start * 10) / 10 + 's'); continue; }
        try { item.setOutPoint(ahT(g.end - g.start + (isStill ? 0 : 0)), 4); } catch (e2) {}
        s.videoTracks[t].overwriteClip(item, g.start);
        var tr = s.videoTracks[t], ti = null;
        for (var j = 0; j < tr.clips.numItems; j++) { if (Math.abs(tr.clips[j].start.seconds - g.start) < 0.01) { ti = tr.clips[j]; placed.push({ clip: ti, track: t, index: j }); break; } }
        if (ti && Math.abs(ti.end.seconds - g.end) > 0.02) { try { ti.end = ahT(g.end); } catch (e3) { notes.push('trim V' + (t + 1) + ' to length by hand'); } }
    }
    return { placed: placed, notes: notes };
}
function ahPlacedJson(res) {
    var tr = [];
    for (var i = 0; i < res.placed.length; i++) { tr.push('"V' + (res.placed[i].track + 1) + '"'); }
    return '"placed":[' + tr.join(',') + '],"notes":[' + (res.notes.length ? '"' + ahEsc(res.notes.join('; ')) + '"' : '') + ']';
}
function ahAddAdjust(source, perClip, templatePath, recipeJson) {
    try {
        var r = ahRanges(source, perClip === 'true' || perClip === true);
        if (r.error) { return '{"error":"' + ahEsc(r.error) + '"}'; }
        var item = ahAdjustItem(templatePath);
        if (!item) { return '{"error":"NOADJ"}'; }
        var res = ahPlaceRanges(item, r.ranges, false), extra = '';
        if (recipeJson && res.placed.length) {
            var fx = ahApplyRecipe(eval('(' + recipeJson + ')'), res.placed, app.project.activeSequence);
            extra = fx.error ? ',"fxError":"' + ahEsc(fx.error) + '"' : ',"missing":' + ahMissList(fx.miss);
        }
        return '{"ok":true,' + ahPlacedJson(res) + extra + '}';
    } catch (e) { return ahErr(e); }
}
function ahAddStill(filePath, source, perClip, binName) {
    try {
        var r = ahRanges(source, perClip === 'true' || perClip === true);
        if (r.error) { return '{"error":"' + ahEsc(r.error) + '"}'; }
        var bin = ahBin(binName || 'Arena Tools'), item = ahFindIn(bin, filePath);
        if (!item) { app.project.importFiles([filePath], true, bin, false); item = ahFindIn(bin, filePath); }
        if (!item) { return '{"error":"Could not import the matte."}'; }
        return '{"ok":true,' + ahPlacedJson(ahPlaceRanges(item, r.ranges, true)) + '}';
    } catch (e) { return ahErr(e); }
}

/* ---------- Text: editable captions ----------
   Caption track: an SRT becomes a native Premiere caption track (edit / restyle every caption in Essential Graphics).
   Graphics text: one Graphics clip per line from a .mogrt, text written into its Source Text, all on one free track. */
function ahTrackFor(a, b, minTrack) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        for (var k = Math.max(0, minTrack); k < s.videoTracks.numTracks; k++) { if (ahRangeFree(s.videoTracks[k], a, b)) { return '{"track":' + k + '}'; } }
        try { app.enableQE(); qe.project.getActiveSequence().addTracks(1, s.videoTracks.numTracks, 0); } catch (e1) {}
        s = app.project.activeSequence;
        var t = s.videoTracks.numTracks - 1;
        if (t >= minTrack && ahRangeFree(s.videoTracks[t], a, b)) { return '{"track":' + t + ',"added":true}'; }
        return '{"error":"No free video track over the caption span. Add an empty track and try again."}';
    } catch (e) { return ahErr(e); }
}
function ahCaptionTrack(srtPath) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var bin = ahBin('Arena Text'), item = ahFindIn(bin, srtPath);
        if (!item) {
            if (!app.project.importFiles([srtPath], true, bin, false)) { return '{"error":"Premiere could not import the SRT."}'; }
            item = ahFindIn(bin, srtPath);
        }
        if (!item) { return '{"error":"The SRT was imported but not found in the Arena Text bin."}'; }
        var fmt; try { fmt = Sequence.CAPTION_FORMAT_SUBTITLE; } catch (e1) {}
        var ok = fmt !== undefined ? s.createCaptionTrack(item, 0, fmt) : s.createCaptionTrack(item, 0);
        if (ok === false) { return '{"error":"Premiere refused to make a caption track from this SRT."}'; }
        return '{"ok":true}';
    } catch (e) { return ahErr(e); }
}
/* the Source Text parameter of a Graphics / MOGRT clip: {prop, value} */
function ahTextParam(c) {
    var comps = [], i, j;
    try { var m = c.getMGTComponent(); if (m) { comps.push(m); } } catch (e) {}
    for (i = 0; i < c.components.numItems; i++) { comps.push(c.components[i]); }
    var fallback = null;
    for (i = 0; i < comps.length; i++) {
        for (j = 0; j < comps[i].properties.numItems; j++) {
            var pr = comps[i].properties[j], v = '';
            try { v = String(pr.getValue()); } catch (e2) {}
            if (v.indexOf('"textEditValue"') >= 0) { return { prop: pr, value: v }; }
            if (!fallback && /source text|text|title|caption|line/i.test(pr.displayName) && v && v.charAt(0) !== '{' && isNaN(+v)) { fallback = { prop: pr, value: v }; }
        }
    }
    return fallback;
}
/* write text and / or font size; returns the size before the change (0 when the template has none) */
function ahSetText(c, text, size) {
    var tp = ahTextParam(c);
    if (!tp) { return -1; }
    if (tp.value.indexOf('"textEditValue"') < 0) { if (text !== null) { tp.prop.setValue(text, true); } return 0; }
    var o = eval('(' + tp.value + ')'), before = 0;
    if (o.fontSizeEditValue && o.fontSizeEditValue.length) { before = +o.fontSizeEditValue[0] || 0; }
    if (text !== null) {
        o.textEditValue = text;
        for (var k in o) {          // one style run over the whole new text, so old run lengths can't cut it up
            if (o.hasOwnProperty(k) && o[k] instanceof Array && o[k].length > 1 && /EditValue$|Value$/.test(k)) { o[k] = [o[k][0]]; }
        }
        if (o.fontTextRunLength) { o.fontTextRunLength = [text.length]; }
    }
    if (size && o.fontSizeEditValue) { o.fontSizeEditValue = [size]; }
    tp.prop.setValue(ahJson(o), true);
    return before;
}
function ahMotionProp(c, name) {
    var m = ahComp(c, 'Motion') || ahComp(c, 'Vector Motion');
    return ahProp(m, name);
}
/* lines: JSON [{s,e,t}] in sequence seconds. pct: size as % of the template (100 = as designed). */
function ahCapBatch(mogrt, track, linesJson, pct) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var L = eval('(' + linesJson + ')'), placed = 0, textSet = 0, base = 0, unit = '', TICKS = 254016000000;
        for (var i = 0; i < L.length; i++) {
            var item = s.importMGT(mogrt, String(Math.round(L[i].s * TICKS)), track, 0);
            if (!item) { continue; }
            placed++;
            try { item.end = ahT(L[i].e); } catch (e1) {}
            var b = ahSetText(item, L[i].t, 0);
            if (b >= 0) { textSet++; }
            if (b > 0 && !unit) { base = b; unit = 'px'; }
            if (!unit && b === 0) { unit = '%'; }
            if (pct && pct !== 100) {
                if (b > 0) { ahSetText(item, null, Math.round(b * pct / 100)); }
                else { var sc = ahMotionProp(item, 'Scale'); if (sc) { sc.setValue(pct, true); } }
            }
        }
        return '{"placed":' + placed + ',"textSet":' + textSet + ',"base":' + base + ',"unit":"' + (unit || '%') + '"}';
    } catch (e) { return ahErr(e); }
}
/* restyle placed captions: the selected clips, else every clip on <track> inside a..b.
   pct: size % of base (px templates) or Motion scale; off: vertical offset in % of frame height (0 = as designed). */
function ahCapStyle(track, a, b, pct, base, off) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var list = [], sel = ahSelected(s), i;
        for (i = 0; i < sel.length; i++) { list.push(sel[i].clip); }
        var usedSel = list.length > 0;
        if (!usedSel && track >= 0 && track < s.videoTracks.numTracks) {
            var tr = s.videoTracks[track];
            for (i = 0; i < tr.clips.numItems; i++) { var c = tr.clips[i]; if (c.start.seconds >= a - 0.01 && c.end.seconds <= b + 0.01) { list.push(c); } }
        }
        var done = 0, miss = 0;
        for (i = 0; i < list.length; i++) {
            var it = list[i], ok = false;
            if (pct !== null) {
                var cur = ahSetText(it, null, 0), want = base > 0 ? base : cur;
                if (want > 0) { ahSetText(it, null, Math.round(want * pct / 100)); ok = true; }
                else { var sc = ahMotionProp(it, 'Scale'); if (sc) { sc.setValue(pct, true); ok = true; } }
            }
            if (off !== null) {
                var po = ahMotionProp(it, 'Position');
                if (po) { var v = po.getValue(); if (v && v.length === 2) { po.setValue([v[0], 0.5 + off / 100], true); ok = true; } }
            }
            if (ok) { done++; } else { miss++; }
        }
        return '{"done":' + done + ',"miss":' + miss + ',"selection":' + usedSel + '}';
    } catch (e) { return ahErr(e); }
}

/* ---------- Drop: delete a dropped file's items from the project (the panel deletes the file on disk) ----------
   ExtendScript has no "delete project item": move every item using this file into a temp bin, then delete that bin.
   Clips of it in sequences go with it. */
function ahDeleteMedia(filePath) {
    try {
        if (!app.project || !app.project.path) { return '{"removed":0}'; }
        var want = String(filePath).toLowerCase(), hits = [];
        ahWalk(app.project.rootItem, function (c) { var mp = ''; try { mp = String(c.getMediaPath()).toLowerCase(); } catch (e) {} if (mp === want) { hits.push(c); } return false; });
        if (!hits.length) { return '{"removed":0}'; }
        var tmp = app.project.rootItem.createBin('__arena_delete');
        for (var i = 0; i < hits.length; i++) { hits[i].moveBin(tmp); }
        tmp.deleteBin();
        return '{"removed":' + hits.length + '}';
    } catch (e) { return ahErr(e); }
}

/* ---------- Text: auto captions — the voice track's audio clips over the range (the panel mixes them with ffmpeg) ---------- */
function ahAudioClips(useInOut, track) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var TICKS = 254016000000, a = 0, b = Number(s.end) / TICKS;
        if (useInOut) {
            try { a = s.getInPointAsTime().seconds; b = s.getOutPointAsTime().seconds; } catch (e1) {}
            if (!(b > a)) { return '{"error":"Set In and Out points on the sequence, or use Whole sequence."}'; }
        }
        var tracks = [], t, j;
        for (t = 0; t < s.audioTracks.numTracks; t++) {
            var n = 0, tr = s.audioTracks[t], muted = false;
            try { muted = tr.isMuted(); } catch (e2) {}
            for (j = 0; j < tr.clips.numItems; j++) { if (tr.clips[j].end.seconds > a && tr.clips[j].start.seconds < b) { n++; } }
            tracks.push('{"i":' + t + ',"name":"A' + (t + 1) + '","clips":' + n + ',"muted":' + muted + '}');
        }
        if (track < 0) {        // default: the first unmuted track that has clips in the range
            for (t = 0; t < s.audioTracks.numTracks; t++) { var tt = s.audioTracks[t], m = false; try { m = tt.isMuted(); } catch (e3) {} if (!m) { for (j = 0; j < tt.clips.numItems; j++) { if (tt.clips[j].end.seconds > a && tt.clips[j].start.seconds < b) { track = t; break; } } } if (track >= 0) { break; } }
        }
        var clips = [];
        if (track >= 0 && track < s.audioTracks.numTracks) {
            var at = s.audioTracks[track];
            for (j = 0; j < at.clips.numItems; j++) {
                var c = at.clips[j], st = c.start.seconds, en = c.end.seconds;
                if (en <= a || st >= b) { continue; }
                var mp = ''; try { mp = c.projectItem.getMediaPath(); } catch (e4) {}
                if (!mp) { continue; }
                var sp = 1; try { sp = c.getSpeed(); } catch (e5) {}
                clips.push('{"path":"' + ahEsc(mp) + '","start":' + st + ',"end":' + en + ',"in":' + c.inPoint.seconds + ',"speed":' + (sp || 1) + '}');
            }
        }
        return '{"a":' + a + ',"b":' + b + ',"track":' + track + ',"tracks":[' + tracks.join(',') + '],"clips":[' + clips.join(',') + ']}';
    } catch (e) { return ahErr(e); }
}
function ahSeek(sec) {
    try { app.project.activeSequence.setPlayerPosition(String(Math.round(sec * 254016000000))); return 'OK'; } catch (e) { return 'ERR:' + e.toString(); }
}
