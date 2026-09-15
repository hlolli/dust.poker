---
status: proposed
---

# Stakes are unshielded test assets escrowed by the contract, one asset per table

Stacks and bonds are escrowed by the contract as an unshielded asset through the standard library's `receiveUnshielded` / `sendUnshielded`. Until the protocol, performance, disconnect economics and legal position have been reviewed, that asset is a valueless test token. The asset is fixed per table while any funds are escrowed. Withdrawal pays out only funds not committed to an unresolved deal, and a seated player's leave takes effect when the current deal ends. Shielded NIGHT is not assumed to be available as a drop-in; capabilities are verified against the standard library before use.

## Considered options

- Shielded stakes: private stack sizes, but poker stacks are public by watching bets, and the shielded coin machinery is a cost with no payoff here.
