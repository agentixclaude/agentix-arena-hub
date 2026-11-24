/* Agentix Arena Hub — ExtendScript host. All functions return JSON or "OK"/"ERR:..." strings. */
function ahEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\t]/g, ' '); }
function ahErr(e) { return '{"error":"' + ahEsc(e && e.toString ? e.toString() : e) + '"}'; }

function ahInfo() {
    try {
        var p = app.project;
        if (!p || !p.path) { return '{"open":false}'; }
        var s = p.activeSequence, sel = s ? ahSelected(s).length : 0;
        return '{"open":true,"project":"' + ahEsc(p.name) + '","sequence":"' + (s ? ahEsc(s.name) : '') + '","selected":' + sel +
            ',"playhead":' + (s ? s.getPlayerPosition().seconds : 0) + '}';
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
function ahImport(filePath, insert) {
    try {
        if (!app.project || !app.project.path) { return '{"error":"Open a project first."}'; }
        var bin = ahBin('Arena Drops'), item = ahFindIn(bin, filePath);
        if (!item) {
            if (!app.project.importFiles([filePath], true, bin, false)) { return '{"error":"Premiere could not import this file."}'; }
            item = ahFindIn(bin, filePath);
        }
        if (!item) { return '{"error":"Imported, but the item was not found in Arena Drops."}'; }
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

/* ---------- Motion: keyframe presets on the selected clips (bezier keys) ---------- */
function ahMotion(presetJson) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var preset = eval('(' + presetJson + ')'), sel = ahSelected(s);
        if (!sel.length) { return '{"error":"Select one or more clips in the timeline."}'; }
        var frame = 1 / 30;
        try { frame = s.getSettings().videoFrameRate.seconds || frame; } catch (e0) {}
        var done = 0, miss = {};
        for (var i = 0; i < sel.length; i++) {
            var c = sel[i].clip, tin = c.inPoint.seconds, tout = c.outPoint.seconds - frame, cleared = {};
            for (var k = 0; k < preset.keys.length; k++) {
                var key = preset.keys[k], pr = ahProp(ahComp(c, key.comp), key.prop);
                if (!pr) { miss[key.comp + ' ' + key.prop] = 1; continue; }
                var at = key.at, t;
                if (typeof at === 'number') { t = tin + at; }
                else { var m = String(at).match(/^end(?:-([\d.]+))?$/); t = tout - (m && m[1] ? parseFloat(m[1]) : 0); }
                if (t > tout) { t = tout; }
                if (t < tin) { t = tin; }
                var id = key.comp + '/' + key.prop;
                if (!cleared[id]) { try { pr.setTimeVarying(false); } catch (e1) {} pr.setTimeVarying(true); cleared[id] = 1; }
                pr.addKey(t);
                pr.setValueAtKey(t, key.v, true);
                try { pr.setInterpolationTypeAtKey(t, 5, true); } catch (e2) {}
            }
            done++;
        }
        var m2 = []; for (var x in miss) { if (miss.hasOwnProperty(x)) { m2.push('"' + ahEsc(x) + '"'); } }
        return '{"ok":true,"clips":' + done + ',"missing":[' + m2.join(',') + ']}';
    } catch (e) { return ahErr(e); }
}

/* ---------- Effects: add an effect and set its values on the selected clips ---------- */
function ahEffect(recipeJson) {
    try {
        var s = app.project.activeSequence;
        if (!s) { return '{"error":"Open a sequence first."}'; }
        var r = eval('(' + recipeJson + ')'), sel = ahSelected(s);
        if (!sel.length) { return '{"error":"Select one or more clips in the timeline."}'; }
        app.enableQE();
        var fx = qe.project.getVideoEffectByName(r.effect);
        if (!fx) { return '{"error":"Premiere has no effect called ' + ahEsc(r.effect) + '."}'; }
        var done = 0, miss = {};
        for (var i = 0; i < sel.length; i++) {
            var it = ahQeItem(sel[i].track, sel[i].index);
            if (!it) { continue; }
            it.addVideoEffect(fx);
            var comp = ahLastComp(sel[i].clip, r.effect);
            for (var name in r.props) {
                if (!r.props.hasOwnProperty(name)) { continue; }
                var pr = ahProp(comp, name);
                if (!pr) { miss[name] = 1; continue; }
                try { pr.setValue(r.props[name], true); } catch (e1) { miss[name] = 1; }
            }
            done++;
        }
        var m2 = []; for (var x in miss) { if (miss.hasOwnProperty(x)) { m2.push('"' + ahEsc(x) + '"'); } }
        return '{"ok":true,"clips":' + done + ',"missing":[' + m2.join(',') + ']}';
    } catch (e) { return ahErr(e); }
}
