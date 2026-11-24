# Agentix Arena Hub

Premiere Pro panel (CEP) for the UGENTIC / Soaring Media edit team. One panel, five tabs:

| Tab | What it does |
|---|---|
| **Drop** | Paste an image, a copied file or a link (image, video, YouTube, Instagram, TikTok, any page with a share image). It lands in `~/Arena Hub/Drops`, the **Arena Drops** bin, and optionally on the timeline at the playhead. webp/avif/heic are converted to PNG. Video pages need `yt-dlp`. |
| **Templates** | Every `.mogrt` on the Mac: yours (`~/Arena Hub/Templates` + Adobe's template library) and Premiere's own. Thumbnails, hover preview, search. Double-click or **Add** drops it at the playhead. |
| **Motion** | Keyframe presets (Punch In, Zoom Reveal, Slide Up, Whip In, Float Card, Slow Push, Slide Out) on the selected clips. Live preview in the card. |
| **Text** | Caption styles previewed on your own line. A style is usable once its `.mogrt` is in `~/Arena Hub/Text`. |
| **Effects** | One-click effect recipes on the selected clips. |

Install: `curl -fsSL https://raw.githubusercontent.com/agentixclaude/agentix-arena-hub/main/install.sh | bash`, then restart Premiere and open **Window › Extensions › Agentix Arena Hub**. The panel updates itself from this repo (`panel/version.json`).

Adding presets: edit `panel/catalog/motion.json`, `effects.json`, `text.json`, bump `panel/version.json`, push.

Keep out of this repo (it is public): footage, exports, `.mogrt` / `.prproj` files, client material, keys or passwords. Templates are shared through the team drive into `~/Arena Hub/Templates`.
