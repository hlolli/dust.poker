#!/bin/sh
# Builds every character in scripts/make-character.py's CAST into src/assets/characters/, one
# Blender process each. Needs MPFB and its asset packs (see make-character.py).
#   scripts/make-characters.sh [blender binary] [name ...]
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BLENDER=${1:-/Applications/Blender.app/Contents/MacOS/Blender}
[ $# -gt 0 ] && shift
NAMES=${*:-frank dean sammy louis tony peggy ella grace dealer bartender}
mkdir -p "$ROOT/src/assets/characters"
for name in $NAMES; do
  "$BLENDER" --background --python "$ROOT/scripts/make-character.py" -- "$name" "$ROOT/src/assets/characters/$name.glb" 2>&1 \
    | grep -E "^\[character\] (building|wrote|mesh Human_export)|Error|Traceback" | cut -c1-200
done
