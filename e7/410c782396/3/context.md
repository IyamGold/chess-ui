# Session Context

## User Prompts

### Prompt 1

can you check our code base to see how we handle rejoining games so users can rejoin even if they reload the tab, mistakenly closed the tab, or change screen by clicking another button?

### Prompt 2

yeah we need to fix all but first i want to understand:

"A player is tied to a game by white_user_id / black_user_id, keyed off their auth token. So "which game am I in" is answerable from
  the DB, independent of any browser state."

what is the full chain id that a player is tied with to a game? e.g room_id/white_user_idd/auth?

### Prompt 3

yes

### Prompt 4

for now lets go back to understanding what each player is tied to the game as.

explain for a non technical user how rejoin works for all the edge cases we considered previously

### Prompt 5

actually what i still struggle to comprehend is what is the chain of id looks like in the server.

passkey_address/roomid/color/gamestate?

like what is the exact sequence

### Prompt 6

actually how do i view the whole database? like visually

### Prompt 7

lets push our edit

