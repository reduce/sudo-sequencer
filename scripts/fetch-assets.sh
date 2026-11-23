#!/usr/bin/env bash
# Fetch the binary assets the stage needs: the CC0 characters and the mocap dances.
# They are gitignored because they are 20 MB of avatars, not because they are secret.
#
# Every file is CC0 or MIT. The licence of each character is in its own VRM metadata, and the
# stage reads it and prints it under the canvas.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p assets/vrm assets/vrma

# a VRM or VRMA is binary glTF: anything else (an HTML error or listing page) is thrown away
isgltf() { [ "$(head -c 4 "$1" 2>/dev/null)" = "glTF" ]; }

av() { # name, url
  [ -s "assets/vrm/$1.vrm" ] && isgltf "assets/vrm/$1.vrm" && { echo "have  assets/vrm/$1.vrm"; return; }
  if curl -fsSL --retry 2 --max-time 180 -o "assets/vrm/$1.vrm" "$2" && isgltf "assets/vrm/$1.vrm"; then
    printf '%-6s %s\n' "$(du -h "assets/vrm/$1.vrm" | cut -f1)" "assets/vrm/$1.vrm"
  else rm -f "assets/vrm/$1.vrm"; echo "FAILED assets/vrm/$1.vrm (the stage skips it)"; fi
}

mo() { # name, url
  [ -s "assets/vrma/$1.vrma" ] && isgltf "assets/vrma/$1.vrma" && { echo "have  assets/vrma/$1.vrma"; return; }
  if curl -fsSL --retry 2 --max-time 120 -o "assets/vrma/$1.vrma" "$2" && isgltf "assets/vrma/$1.vrma"; then
    printf '%-6s %s\n' "$(du -h "assets/vrma/$1.vrma" | cut -f1)" "assets/vrma/$1.vrma"
  else rm -f "assets/vrma/$1.vrma"; echo "FAILED assets/vrma/$1.vrma (that move is skipped)"; fi
}

ANI=https://raw.githubusercontent.com/tunguyen1993/ani-3d-companion/main
# Victoria Rubin (CC0) and the mocap clips, MIT repository
av dj "$ANI/assets/models/ani_3d.vrm"
# the six looping bases the dance library is built from
for m in idle bounce dance spin pose wave; do
  mo "$m" "$ANI/assets/motions/ani-$m.vrma"
done
# the first four gestures
for m in peace shoot show talk; do
  mo "$m" "$ANI/assets/motions/ani-$m.vrma"
done

# A wider gesture set from tk256ailab/vrm-viewer (MIT repository): clapping, jumping, relaxing,
# looking around, waving goodbye, a startle, thinking, blushing, anger, the blues and sleep.
# These are gestures, not dances; the dances in the library are derived from the six bases above.
VRMV=https://raw.githubusercontent.com/tk256ailab/vrm-viewer/main/VRMA
g() { mo "$1" "$VRMV/$2.vrma"; }   # local name, then the file in that repository
g clap   Clapping
g jump   Jump
g relax  Relax
g look   LookAround
g bye    Goodbye
g wow    Surprised
g think  Thinking
g blush  Blush
g mad    Angry
g blues  Sad
g sleepy Sleepy

# ToxSam's 100Avatars, CC0, via the opensourceavatars.com registry (Arweave/IPFS)
# each CID is a folder: the URL names the model inside it (the bare CID is an HTML listing)
av aurora "https://gateway.pinata.cloud/ipfs/QmVvfCcAKYozNQwwxPbHyNohLyBJbTrCBSM1Ycck3ouJSj/Avartar_Aurora.vrm"
av orion  "https://gateway.pinata.cloud/ipfs/Qmed8jVF5FvBn6Jerxk8Wm5DwRjuAHRfBXgofTue37orBC/Avatar_Orion.vrm"
av frosty "https://gateway.pinata.cloud/ipfs/QmbNqsuVYaVrYtC6ALeco3jogcSi4NbbzfrGJs5i7fjB26/FrostyBoogie.vrm"

echo
echo "Done. Open the app, press SETUP, and the CHARACTER row lists them."
