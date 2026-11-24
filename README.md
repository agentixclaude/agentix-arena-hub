# Agentix Arena Hub

Premiere Pro panel (CEP) for the UGENTIC / Soaring Media edit team. One panel, five tabs:

| Tab | What it does |
|---|---|
| **Drop** | Paste, drag or link anything: images (incl. webp/avif/heic → PNG), video (VP9/AV1/webm/mkv → H.264), audio, whole folders, Google Drive / Dropbox / OneDrive links, and social links via yt-dlp (YouTube, Instagram, TikTok, X, Facebook, Pinterest, LinkedIn, Reddit, Vimeo…; retries with your Chrome login, falls back to the post image). Saved to `<project folder>/Assets/Drops`, imported to the **Arena Drops** bin, optionally placed at the playhead. |
| **Templates** | The team's picks from the Adobe template library (Carousel 01–05, 1–4) with thumbnails and hover preview. |
| **Motion** | Keyframe presets on the selected clips (parked for now). |
| **Text** | 13 caption styles (incl. box, pill, highlight-box, box-words) drawn on canvas with full properties (font, weight, size, case, colours, outline, shadow, box, corners, padding, position, width, stagger, duration). Live preview on the playhead frame. Apply to: **My line** (rendered at the playhead), **Captions** (the sequence's caption track, read from the saved .prproj since Premiere's API can't read captions; one alpha clip spanning all captions with exact timing) or **Text clips** (selected Graphics text, each re-rendered on the track above, originals turned off). Renders are ProRes 4444 with alpha in `<project>/Assets/Text`, bin **Arena Text**. |
| **Effects** | 31 CapCut-style recipes in four groups (Trending, In / Out, Looks, Arena) built on Premiere 2027's new effects plus keyframed ones, each with a live preview on the playhead frame. |

Install: `curl -fsSL https://raw.githubusercontent.com/agentixclaude/agentix-arena-hub/main/install.sh | bash`, then restart Premiere and open **Window › Extensions › Agentix Arena Hub**. The panel updates itself from this repo (`panel/version.json`).

Adding presets: edit `panel/catalog/motion.json`, `effects.json`, `text.json`, bump `panel/version.json`, push.

Keep out of this repo (it is public): footage, exports, `.mogrt` / `.prproj` files, client material, keys or passwords. Templates are shared through the team drive into `~/Arena Hub/Templates`.
