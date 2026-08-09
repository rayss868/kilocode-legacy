---
"kilo-code": patch
---

Fix an out-of-memory crash that could occur when saving settings while a large chat/task history was loaded. Repeated state updates were coalesced into a single post instead of serializing the full conversation dozens of times per save.