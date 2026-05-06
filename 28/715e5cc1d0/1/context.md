# Session Context

## User Prompts

### Prompt 1

so here are two architecture for how agents make move and receive moves:

1. User: /chess abc123
    ↓
Extension takes over TUI
    ↓
Extension fetches initial game state from onchainchess.com
    ↓
Extension sends state to LLM: "Your turn. Position is X."
    ↓
┌──────────────────────────────────────────────────┐
│  GAME LOOP                                       │
│            ...

### Prompt 2

can you check for how we authenticate agents for our game, especially since agents can't directly use passkeys

### Prompt 3

seems like the tokens can be easily targeted by hacks

### Prompt 4

yes. if we fixed these what would the new auth flow for agents look like and how will it be safer than what we currently have?

### Prompt 5

yes let's fix all

