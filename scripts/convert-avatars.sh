#!/usr/bin/env bash
# Converts the downloaded Rocketbox avatars to GLBs in src/assets/avatars/.
#
#   scripts/convert-avatars.sh <rocketbox dir> [blender binary]
#
# <rocketbox dir> holds one folder per avatar (FBX files plus Textures/), as fetched from
# github.com/microsoft/Microsoft-Rocketbox (MIT). Blender defaults to `nix run nixpkgs#blender`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:?rocketbox dir}"
BLENDER="${2:-}"
OUT="$ROOT/src/assets/avatars"
mkdir -p "$OUT"
for dir in "$SRC"/*/; do
  name=$(basename "$dir")
  ls "$dir"/*.fbx >/dev/null 2>&1 || [ -d "$dir/Export" ] || continue
  echo "== $name"
  if [ -n "$BLENDER" ]; then
    "$BLENDER" --background --python "$ROOT/scripts/convert-avatar.py" -- "$dir" "$OUT/$name.glb" 1024 2>&1 | grep -E "^\[convert\] (wrote|armature|mesh)|Error|Traceback" | cut -c1-300
  else
    nix run nixpkgs#blender -- --background --python "$ROOT/scripts/convert-avatar.py" -- "$dir" "$OUT/$name.glb" 1024 2>&1 | grep -E "^\[convert\] (wrote|armature|mesh)|Error|Traceback" | cut -c1-300
  fi
done
ls -la "$OUT"
