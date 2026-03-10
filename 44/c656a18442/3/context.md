# Session Context

## User Prompts

### Prompt 1

check our implementation.md file, which part of feature did we implement that preserves the prese
rves ongoing game states if by any chance a user reloads the tab? we have both online PvP games, and local PvE games, and we have two separate servers thatt we need to maintain persistence

### Prompt 2

first add the following details above to the implementation.md file under a new section "Game state persistence"

### Prompt 3

alright can i visually look at the sqlite table to see whats there and whats not?

### Prompt 4

okay so lets assume i was playing Room 6 with 68 moves as BLACK, but i mistakenly reloaded the tab. walk me through how the server fetches the room code, or token, sends to the frontend to show the game on my profile under "game history" so that i can just click on the game and continue from where i stopped before i reloaded the tabs.

point me to the code too

### Prompt 5

okay how does it work for local games with stockfish then? if i were to reload the tab while i was playing PvE which seems to be stored locally on the user's browser... how does our server fetch the game state and resumes the game, and also displays it on the users game history?

### Prompt 6

now im not sure how or why, but between step 2/3 and step 4 there's a problem. because when we reload the tab for local games, we land on game list but we dont see our game history. we land on a sort of profile that has no game history.

then the only way to access the game history is to create a fresh game (on this fresh profile we landed on), and then click "Back to Games".

so in summary, if i played a local game with stockfish and reloaded the tab, it'll land me somewhere else that is a fres...

### Prompt 7

yes test it

