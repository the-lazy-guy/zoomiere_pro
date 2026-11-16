#!/bin/bash
# ZoomPro installer for macOS. Double-click it (or run: bash Install-Mac.command).
cd "$(dirname "$0")" || exit 1
SRC="$(pwd)/extension"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.zoompro.panel"

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "Could not find the \"extension\" folder next to this file."
  echo "Unzip the whole download first, then run this installer again."
  read -r -p "Press Enter to close..." _
  exit 1
fi

echo "Installing ZoomPro to:"
echo "  $DEST"
echo

# Allow unsigned CEP panels (needed for panels not installed through Adobe Exchange)
for v in 9 10 11 12 13 14 15 16 17 18 19 20 21 22; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
killall cfprefsd 2>/dev/null

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"
# Files downloaded from the internet are quarantined; Premiere won't load a quarantined panel
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null

echo "Done!"
echo
echo "1. Restart Premiere Pro."
echo "2. Open  Window > Extensions > ZoomPro"
echo
read -r -p "Press Enter to close..." _
