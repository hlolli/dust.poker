#!/bin/sh
# Builds the standalone Midnight indexer from source into local/bin/. The wallet SDK asks the
# indexer for fields that arrived in 4.4.0-rc.4, and no image past rc.2 is on Docker Hub.
# rustup reads the repo's rust-toolchain.toml (1.95.0). Takes a while the first time.
set -eu
TAG=v4.4.0-rc.5
here=$(cd "$(dirname "$0")" && pwd)
src="$here/.indexer-src"
if [ ! -d "$src" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/midnightntwrk/midnight-indexer "$src"
fi
cd "$src"
cargo build --release -p indexer-standalone --locked --features standalone
mkdir -p "$here/bin"
cp target/release/indexer-standalone "$here/bin/"
echo "built $here/bin/indexer-standalone ($TAG)"
