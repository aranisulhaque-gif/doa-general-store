# Project Rules & Guidelines

## Hybrid SOP Context Purging
When the conversation context size grows large (e.g. system warnings or log sizes >1.5MB), the agent must:
1. Summarize all previous chat memory in 250 characters or less.
2. Instruct the user to clear the context window (via 'New Topic' or Ctrl+R) to maintain performance and avoid token amplification risk.
3. Start utilizing a new log file in the background when the context log size becomes too large.
