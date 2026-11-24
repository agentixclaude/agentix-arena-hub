# Agentix Arena Hub

Premiere Pro panel (CEP) for the UGENTIC / Soaring Media edit team. One panel, six tabs:

| Tab | What it does |
|---|---|
| **Drop** | Paste, drag or link anything: images (incl. webp/avif/heic → PNG), video (VP9/AV1/webm/mkv → H.264), audio, whole folders, Google Drive / Dropbox / OneDrive links, and social links via yt-dlp (YouTube, Instagram, TikTok, X, Facebook, Pinterest, LinkedIn, Reddit, Vimeo…; retries with your Chrome login, falls back to the post image). Saved to `<project folder>/Assets/Drops`, imported to the **Arena Drops** bin, optionally placed at the playhead. |
| **Drop (Recent drops)** | **Clear** empties the list. **✕** on a drop: Remove from list, or Delete file + from project. |
| **Templates** | The team's picks from the Adobe template library (Carousel 01–05, 1–4) with thumbnails and hover preview. |
| **Motion** | Keyframe presets on the selected clips (parked for now). |
| **Text** | **Auto captions**: one button transcribes the voice track (whole sequence or In–Out) on your Mac, offline (whisper). One line per caption (words-per-line slider, ALL CAPS). Unsure words are highlighted orange; **N to check →** jumps to each one and moves the playhead there so you can listen and fix. **Spelling fixes** correct brand words automatically (ANIK, UGENTIC, CloneIQ, Clone.Studio… add your own). Every line is editable. Live 9:16 preview with Size / Position. **Place** as editable Graphics text clips (from a caption .mogrt) or as a Premiere caption track; Size / Position restyle them all afterwards. Also: Load SRT, Use caption track, Save SRT. Nothing is rendered: no .mov files. |
| **Effects** | 31 CapCut-style recipes in four groups (Trending, In / Out, Looks, Arena) built on Premiere 2027's new effects plus keyframed ones, each with a live preview on the bundled Anik photos (or the playhead frame). |
| **Tools** | Smart place over the selected section (selected clips, one layer or one per clip, or sequence In–Out): **Adjustment layer** (optionally with any Effects recipe on it) and **Matte & overlays** (solid colour, gradient, vignette, bars, Reels/TikTok/Shorts safe-zone guide) generated at sequence size into `<project>/Assets/Mattes`. Lands on the first track above the selection that is empty for the whole range; adds a track if all are busy. Never overwrites. |

## Install (macOS, once per Mac)

Open Terminal and paste:

```
curl -fsSL https://raw.githubusercontent.com/agentixclaude/agentix-arena-hub/main/install.sh | bash
```

Then restart Premiere and open **Window › Extensions › Agentix Arena Hub**. The installer also adds **ffmpeg**, **yt-dlp** and **whisper-cpp** through Homebrew when Homebrew is installed (needed for Drop links and Auto captions). The first Auto captions run downloads the speech model once (Accurate 488 MB / Fast 148 MB) into `~/Arena Hub/models`.

Updates: the panel shows **Update now** when a new version is on GitHub (`panel/version.json`).

Caption style: for Graphics text captions, make one caption template once. In Premiere, type a line with the Type tool, style it, choose Graphics › Export as Motion Graphics Template, then drop the .mogrt on the Text tab. It is kept in `~/Arena Hub/Caption Templates`. No template? Pick **Premiere caption track** in Style.

Adding presets: edit `panel/catalog/motion.json` or `effects.json`, bump `panel/version.json` (and the version in `panel/CSXS/manifest.xml`), push.

Keep out of this repo (it is public): footage, exports, `.mogrt` / `.prproj` files, client material, keys or passwords. Templates are shared through the team drive into `~/Arena Hub/Templates`.

Preview photos in `panel/assets/preview` are the only images kept in the repo (small JPGs, used for offline previews).
