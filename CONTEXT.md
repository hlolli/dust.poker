# dust.poker

A No-Limit Texas Hold'em table rendered as a 3D casino room in the browser (desktop and WebXR), where the rules and the pot are enforced by a smart contract on the Midnight blockchain rather than by any server.

## Language

### Play

**Table**:
One poker game in progress: its seats, its pot, and the current deal. There is one table in v1.
_Avoid_: Room, game, lobby

**Practice table**:
A table where every other seat is a bot and the referee runs inside the player's own browser. Nothing is at stake and nothing leaves the machine.
_Avoid_: Offline mode, demo, sandbox, bot mode

**Live table**:
A table refereed on Midnight, with other humans in the seats and real stakes in the pot.
_Avoid_: Online mode, on-chain mode, real game

**Presence**:
What a seated player shows the table beyond their actions: where their head is looking, their hands, their voice. Shared between players, never seen by the referee, and never binding.
_Avoid_: Avatar state, telemetry, stream

**Seat**:
One of up to six positions at the table. A seat is empty, held by a player, or held by a bot.
_Avoid_: Slot, position

**Player**:
A human sitting at the table.
_Avoid_: User, participant

**Queue**:
Players who have asked to play a live table and are waiting for the referee to seat them. Players never choose a table or a seat.
_Avoid_: Lobby, waiting room, matchmaking

**Stack**:
The chips a seat has at the table, available to wager. Distinct from whatever the player holds in their wallet.
_Avoid_: Balance, chips (as the general term), bankroll

**Bot**:
A seat filled by an automated opponent following the same rules as a player.
_Avoid_: AI, NPC, agent

**Deal**:
One unit of play from shuffle to payout: blinds, hole cards, streets, showdown or last fold.
_Avoid_: Hand (see below), round, game

**Street**:
One betting round within a deal: pre-flop, flop, turn, river.
_Avoid_: Round, phase

**Hole cards**:
The two private cards held by one seat during a deal.
_Avoid_: Hand, pocket, private cards

**Board**:
The community cards shared by all seats: three on the flop, one on the turn, one on the river.
_Avoid_: Community cards, table cards

**Hand**:
The best five-card combination a seat can make from its hole cards and the board, ranked at showdown. Only used in this sense.
_Avoid_: Using "hand" for a deal or for hole cards

**Showdown**:
The end of a deal in which every seat still in reveals its hole cards and the best hand takes the pot. A deal that ends by folding has no showdown.
_Avoid_: Reveal, endgame

**Pot**:
The chips wagered in the current deal, held by the referee until payout.
_Avoid_: Bank, prize

**Action**:
A single move by a seat on its turn: fold, check, call, bet, raise.
_Avoid_: Move, play, bet (as the general term)

### Authority

**Referee**:
The party that enforces the rules, holds the pot, and pays out. The smart contract on Midnight; never a server or a browser.
_Avoid_: Server, backend, dealer, house
