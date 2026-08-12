---
"kilo-code": minor
---

Keep more of the recent conversation (the last 10 messages) after auto-condensing, and show the current todo list to the model so it stays aware of the plan after condensing. When re-condensing fails after uncondensing for extended-thinking compatibility, the extension now falls back to sliding-window truncation instead of sending the entire raw history, so the model still reads the most recent messages instead of repeating the start of the conversation.
