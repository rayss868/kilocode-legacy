---
"kilo-code": patch
---

Fix the chat panel occasionally appearing blank after a network error, a mid-operation stop, or returning to a checkpoint: state updates are no longer dropped by the post throttle, and an aborted/empty response at the end of the conversation stays visible instead of being filtered out.
