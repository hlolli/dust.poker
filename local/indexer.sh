#!/bin/sh
# Runs the indexer built by local/build-indexer.sh against the node from local/compose.yml.
# Its databases live in local/data; remove that folder when the chain starts over.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$here/data"
cd "$here"
export CONFIG_FILE="$here/indexer.yaml"
export RUST_LOG="${RUST_LOG:-indexer=info,chain_indexer=info,indexer_api=info,wallet_indexer=info,indexer_common=info,fastrace_opentelemetry=off,warn}"
# Test values: this chain holds nothing. The secret keys the wallet indexer's session store.
export APP__INFRA__SECRET="303132333435363738393031323334353637383930313233343536373839303132"
export APP__INFRA__SPO_NODE__BLOCKFROST_ID="dummy-not-using-spo"
exec "$here/bin/indexer-standalone"
