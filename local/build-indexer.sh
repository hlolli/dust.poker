#!/bin/sh
# Optional host build; compose.yml normally runs the released image.
# rustup reads the tagged source's rust-toolchain.toml.
set -eu
TAG=v4.4.101
here=$(cd "$(dirname "$0")" && pwd)
src="$here/.indexer-src"
if [ ! -d "$src" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/midnightntwrk/midnight-indexer "$src"
fi
cd "$src"
if [ "$(git describe --tags --exact-match HEAD)" != "$TAG" ]; then
  echo "$src is not $TAG; move the old checkout aside before building the released indexer" >&2
  exit 1
fi
cargo build --release -p indexer-standalone --locked --features standalone
mkdir -p "$here/bin"
cp target/release/indexer-standalone "$here/bin/"
echo "built $here/bin/indexer-standalone ($TAG)"
