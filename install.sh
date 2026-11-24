#!/bin/bash
# Agentix Arena Hub — install or update on macOS:  curl -fsSL https://raw.githubusercontent.com/agentixclaude/agentix-arena-hub/main/install.sh | bash
set -e
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.uai.arenahub"
TMP="$(mktemp -d)"
curl -fsSL https://codeload.github.com/agentixclaude/agentix-arena-hub/zip/refs/heads/main -o "$TMP/a.zip"
unzip -q "$TMP/a.zip" -d "$TMP"
mkdir -p "$DEST"
cp -R "$TMP"/agentix-arena-hub-main/panel/. "$DEST/"
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
rm -rf "$TMP"
echo "Installed. Restart Premiere Pro, then Window > Extensions > Agentix Arena Hub."
