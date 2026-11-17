# Live table correctness review

November 17, 2026. Reviewed `31690f6..8875cc4`, covering the Ledger v9 integration and the local shuffle change, with the contract and Practice referee as dependencies. Fixes accompany this report.

## Executive summary

| Severity | Findings | Resolution |
| --- | ---: | --- |
| Critical | 0 | |
| High | 4 | Fixed in source, regression coverage added |
| Medium | 3 | Fixed, regression coverage added |
| Low | 0 | |

**Original risk: high. Recommendation: conditional on a fresh contract compile, full tests, and the proof gate.** This review establishes specific correctness fixes, not public-network readiness or a complete audit of the dealing cryptography.

The four high findings concern accepting unsafe tables, accepting invented opening state, aborting a completed showdown, and failing to recover from a disconnected player. The three medium findings concern missed state updates, selecting a player who is sitting out to start a deal, and allowing a URL to bypass the test-network restriction.

The root Ledger dependency also moves from `1.0.0-rc.4` to `1.0.2`, with its browser WASM imports updated. The existing real-proof deployment and join test passes against that stable release. This package update is not counted as a separate locally reproduced finding.

## Scope and baseline

The repository has 89 tracked TypeScript, JavaScript, and Compact files. The focused differential scope contains 25 changed files, including one binary verifier fixture, with 1,934 added and 328 removed text lines:

| Area | Files examined | Risk |
| --- | --- | --- |
| Contract | `contracts/deal.compact`, `deal.test.ts`, `harness.ts` | High |
| Transactions and identity | `src/live/ledger.ts`, `ledger.test.ts`, `live.ts`, `chain.ts`, `local.ts` | High |
| State and recovery | `src/live/referee.ts`, `referee.test.ts`, `indexer.ts`, `indexer.test.ts` | High |
| Wallet and browser runtime | `src/live/wallet.ts`, `bridge-wallet.ts`, `ledger-shim.js`, `ledger-shim.d.ts`, `any.verifier` | High |
| Shared rules and entry | `src/referee/contract.ts`, `rules.ts`, `src/ui/menu.ts` | Medium |
| Build | `package.json`, `scripts/build-contracts.ts`, `build-site.ts`, `dev.ts`, `wasm-plugin.ts` | Medium |

All 25 scoped files were read or inspected. Tests, `contracts/client.ts`, the domain glossary, ADRs 0001 and 0004 through 0008, installed runtime types, and CI configuration supplied dependency context. Rendering, character assets, audio, the wallet SDK implementation, and a full audit of the local network tooling were outside the scope.

Expected behavior was derived from the contract, domain rules, and executable scenarios, independently of commit descriptions:

- A join must establish both immutable rules and a valid empty opening before sending funds.
- Stacks and bonds must come from actual escrow, and a fresh deck must come from the constructor.
- An abort must identify a player who still owes a step. Completed showdowns remain payable.
- Connected players must observe every state transition and be able to recover after a peer leaves.
- Private deck keys survive reloads and rotate once per deal.
- The browser interface remains limited to the configured test networks.

## Findings

### H1. Table verification accepted extra entry points and unsigned maintenance

**Location:** `src/live/ledger.ts:91`, introduced by `b3e266f`.

`isOurs` checked the expected keys but did not reject additional operations. It also treated an empty maintenance committee as immutable even when the signature threshold was zero. Both states passed the old check.

**Concrete scenario:** a table creator supplies every expected circuit alongside an additional entry point, or supplies an empty committee with threshold zero. The browser accepts the table. In the second case an unsigned maintenance transaction can add another operation after players join. This crosses the boundary between the rules the player verified and the rules the table can execute.

**Evidence:** a ledger-applied test installs an additional operation using unsigned maintenance while signature validation is enabled. Separate tests cover extra textual and binary operation names. The old check failed both rejection tests; the fix passes them.

**Fix:** require a nonzero threshold with an empty committee, exactly the expected operation count, and matching serialized operations. The serialized comparison also rejects additional versioned keys or metadata that the current `verifierKey` accessor alone would not compare. An end-to-end legacy-proof scenario was not constructed; that broader comparison is defense in depth, not a separately claimed exploit.

**Exploitability:** easy for a table creator. **Blast radius:** every `joinTable` entry through the menu or local integration script. Previously no negative tests for either acceptance condition.

### H2. Matching verifier keys did not authenticate the opening state

**Location:** `src/live/live.ts:60`, integration introduced by `4f45fa8`; the later verification in `b3e266f` covered keys only.

A deployment can contain arbitrary public data. Knowing the current verifier keys does not prove that stacks started at zero or that the fresh deck came from the constructor.

**Concrete scenario and evidence:** run a join locally, put its resulting public data into a deployment with the expected keys and no escrow balance, and deploy that state. The ledger accepts it, and the previous join gate trusts it. Its prefilled stack is not backed by a buy-in. Checking only current escrow would also leave substituted deck data unauthenticated.

**Fix:** before a verified join or rejoin, fetch the state at the last maintenance update, or the deploy if no update exists. Require that state to have the exact immutable operation set, no escrow, and the constructor's complete public data for the supported asset. Current state is verified separately. The deployment workflow waits for locking to be indexed before accepting joins.

The indexer query uses `contract.actions(limit: 1, type: UPDATE)` and `DEPLOY`, confirmed in the [v4.4.101 schema](https://github.com/midnightntwrk/midnight-indexer/blob/v4.4.101/indexer-api/graphql/schema-v4.graphql). Historical action state is resolved at the end of its block. A table that already has calls in its locking block can therefore fail this conservative check; normal `deployTable` waits for that block before joining. Missing history or unsupported schema fails closed.

**Tests:** honest first join, subsequent join, and rejoin; rejection of prefilled, missing, and mutable opening states before any transaction is submitted; indexer selection and error propagation.

**Exploitability:** easy for a table creator. **Blast radius:** the same verified join boundary as H1. This boundary previously had no constructor-state coverage.

### H3. Expiry could strand a completely scored showdown

**Location:** `contracts/deal.compact:1238`; `first_without_score` path dates to `ac844b2` and `ce90b31`, before the selected differential baseline.

After every remaining player has proved their hand, the phase stays at showdown until settlement. After its deadline, `expire` selected `NONE` as the offender and still changed the phase to aborted. `settle` then refused the phase, while `settle_abort` refused the missing offender.

**Concrete scenario:** check through the river, prove all hands, advance beyond the showdown deadline, and call the permissionless expiry circuit before settlement. The original circuit accepts the call. The pot has no valid settlement path.

**Fix:** assert that an offender exists before changing the phase. The Live client also prioritizes completed settlement over expiry.

**Test:** the existing complete-showdown test now advances beyond the deadline, requires expiry to reject, and then verifies that normal settlement conserves and pays the pot. This regression failed against the old generated circuit. A fresh compile and new `expire` proving key are required.

**Exploitability:** medium, requiring an overdue scored showdown. **Blast radius:** every table's permissionless expiry path. The contract dependency was inspected beyond changed lines to find this pre-existing defect.

### H4. Live clients did not recover from missed deadlines

**Locations:** `src/live/referee.ts:200`, `src/referee/rules.ts:112`; introduced with the Live referee in `63d843e`.

The client never submitted `expire` or `expire_next`, never checked or folded automatically at its displayed betting deadline, and assigned abort settlement to the lowest occupied seat. When that seat was the disconnected offender, the surviving client would not settle even an externally expired deal.

**Fix:** use observed block time for permissionless expiry; perform automatic check-or-fold with the contract's submission slack; let surviving occupants settle aborts and completed showdowns; stop automatic actions after losing ownership of a seat. Empty seats are cleared from the view.

**Tests:** with seat zero absent, seat one posts its key, observes expiry, settles the abort, receives the correct 401-chip stack, and sees seat zero freed. A separate two-client test advances to the displayed betting deadline and verifies a normal fold-win without losing the player's bond or seat.

**Exploitability:** ordinary disconnection is sufficient. **Blast radius:** both Live clients and shared settlement scheduling. Permissionless recovery may be attempted concurrently by multiple clients; the contract permits one state transition, and losing transactions may still pay a fee.

### M1. Partial serialized-state comparison missed real changes

**Location:** `src/live/referee.ts:150`; introduced by `63d843e`.

The client compared serialized length and only the first and last 64 bytes. A buy-in was reproduced with different full state but identical old fingerprints. The client then skipped publication and pending-action completion despite the new balance.

**Fix:** compare the complete byte sequence. The regression checks that every one of four consecutive buy-ins reaches subscribers. Ledger serialization can also normalize trie layout, so the test asserts observable balances rather than requiring every transaction to have the same prefix.

### M2. Sitting out could prevent the remaining players starting

**Location:** `src/live/referee.ts:227`; introduced by `63d843e`.

The designated starter was the lowest occupied seat with chips, even when that seat had requested to sit out. If its client was absent, two available players waited indefinitely. The same count could attempt starts when fewer than two eligible players remained.

**Fix:** choose and count only occupied seats with chips that are not leaving. A three-seat regression has seat zero sit out and confirms that seat one starts with seats one and two only.

### M3. A shared URL could bypass the test-network selector

**Location:** `src/live/wallet.ts:74`; exposed by the network selection change in `897df44`.

The menu listed test networks, but `?network=mainnet` flowed directly to `connect` before the configured fallback list. A wallet on Mainnet could connect to an interface describing its stakes as test chips.

**Fix:** reject network identifiers outside `NETWORKS` before opening the wallet. The regression verifies that neither Mainnet nor an unknown identifier invokes the wallet connector.

## Test coverage and validation

- Baseline local validation: type checking, all 49 tests, the real-proof ledger test, and the site build passed with existing generated artifacts.
- The first push, `8875cc4`, passed [fresh compilation and CI](https://github.com/hlolli/dust.poker/actions/runs/44100385578).
- Before committing the review fixes, type checking and all 21 tests under `src/live` and `src/referee` passed, including the real-proof ledger test on Ledger `1.0.2`.
- The expired-showdown regression was demonstrated failing against the old compiled contract. Its source fix requires fresh compiler output and proof verification.
- The browser build passed with the stable Ledger WASM imports. No real Lace session or public-network transaction was executed.
- `bun run check` was attempted locally. Compact aborts even for `--version` because it hardcodes `/tmp/chezschemeboot...`, which this session cannot write. Escalated attempts did not remove that restriction. CI publishes the generated contract and ZKIR so the exact committed source can be validated locally after its Linux compile.

The final push's CI and proof gate are the fresh-artifact checks. Their status is reported with the delivered commit rather than predicted in this report. No numeric line-coverage claim is made. Remaining gaps include real wallet balancing and consent, network reorganization and adversarial indexers, long proving delays, simultaneous user actions and background preparation, and an exhaustive property audit of the dealing protocol.

## Blast radius

Counts are direct non-test call sites, excluding definitions and similarly named Web Audio methods. Dynamic contract dispatch is listed separately.

| Function or boundary | Direct callers after fixes | Reach |
| --- | ---: | --- |
| `isOurs` | 2 | Current-state and opening verification for every verified join |
| `joinOn` | 1 | `joinTable`; tests also exercise the generic chain seam |
| `joinTable` | 4 | Menu plus three local integration call sites |
| `callOn` | 2 | Joining and all Live referee transactions |
| `callTx` | 1 | Every call assembled through `callOn` |
| `owed` | 2 | Practice and Live referees |
| Wallet `connect` | 2 | Initial connection and network selection |
| Contract `expire` | Dynamic dispatch | Live recovery, harness tests, and proof gate |

Critical path: menu → wallet → join gate → indexer opening/current state → circuit execution → ledger transaction → wallet proof/balance/submit → indexer → Live referee.

## Historical context

`4f45fa8` introduced ledger deployment and joining. `63d843e` extracted shared rules and added Live orchestration; `7a00c67` added push subscriptions, and `525b4bc` added reload recovery. `b3e266f` introduced staged deployment and verifier checks. `897df44` exposed Preview and Preprod through the menu. `8875cc4` preserved the local fresh-shuffle change.

The review found missing validation and orchestration, not removal of a previously documented security fix. The escrow invariants, permissionless recovery policy, and test-asset restriction were checked against ADRs rather than inferred from those commits' descriptions.

## Release implications

The `expire` circuit and its verifier key change. Generate matching keys and open a new table; an already immutable deployment cannot be upgraded and will fail the site's exact-key check. Serve the matching ZKIR and keys alongside the site or through its configured key URL. A clean static build without proving artifacts still supports Practice only.

The stable Ledger package is independently documented in the [9.1.0.2 release](https://github.com/midnightntwrk/midnight-ledger/releases/tag/ledger-9.1.0.2). The public-network upgrade and current SDK/toolchain guidance are documented in [Ledger 9 upgrade](https://docs.midnight.network/relnotes/ledger-9). This review retains Compact 0.34 and its matched prover, whose proofs are exercised against the stable ledger; it does not claim migration to every component in the newer SDK matrix. Local Docker and wallet SDK development pins were not upgraded.

## Method and confidence

Focused differential review, baseline and dependency tracing, git history and blame, quantified callers, adversarial table-authentication analysis, real in-memory ledger application, real proof verification, and regression tests at the client/chain seam.

Confidence is high in the reproduced failures and the tested client fixes. Fresh compilation and proving remain required for the contract change. Public-network interoperability and the full cryptographic protocol require separate validation. All seven concrete findings have fixes in this change; the stated coverage limits are not a claim that all possible defects have been eliminated.
