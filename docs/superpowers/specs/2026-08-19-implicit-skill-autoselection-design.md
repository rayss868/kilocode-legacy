# Implicit Skill Auto-Selection

## Status

Draft for user review.

## Goal

Automatically select and load the single most relevant registered skill when a new user request clearly matches that skill, even when the user does not mention the skill by name. Keep explicit skill loading and inventory queries working as they do today, while avoiding false positives, ambiguous silent selection, repeated loading, and filesystem discovery during task execution.

Example:

```text
User: Buat artikel dengan bahasa yang natural dan terasa ditulis manusia.
Runtime: pilih human-like-writer jika kecocokannya jelas.
Runtime: muat instruksi SKILL.md sebelum request model pertama.
Agent: mengerjakan task dengan instruksi skill tersedia di context.
```

## Scope

This change covers:

- deterministic preflight matching for implicit skill applicability;
- automatic loading of at most one skill for each new user message/task execution;
- clear-match, ambiguous-match, and no-match behavior;
- task-local tracking so the same skill is not loaded repeatedly;
- focused tests for resolver integration and task lifecycle behavior.

This change does not add:

- cross-task skill memory;
- subagents, verifier agents, model routing, or orchestration services;
- embeddings, an additional model request, or external semantic-search services;
- automatic loading of multiple skills;
- arbitrary filesystem lookup based on user text;
- changes to the existing approval UI or `load_skill` explicit fallback path.

## Existing Context

`SkillsManager` already discovers and registers `SkillMetadata`, filters skills with `getSkillsForMode(currentMode)`, resolves fuzzy explicit queries with `resolveSkillQuery`, and loads registered `SKILL.md` content with `loadSkillByQuery`. The prompt already exposes available skill metadata, and `load_skill` handles explicit model requests.

The missing behavior is a deterministic runtime decision before the first model request for a new user message. Prompt instructions alone cannot guarantee that the model will select a relevant skill.

The task lifecycle boundary is `Task.submitUserMessage()`. It receives a new user message before the normal request loop begins. The preflight must not run inside the recurring tool/request loop, because doing so would reload skills after every tool result or retry.

## Design

### 1. Hybrid selection model

Use two complementary paths:

1. **Implicit request:** `Task.submitUserMessage()` invokes a deterministic applicability preflight before posting the message to the webview/request flow.
2. **Explicit request:** the existing `load_skill` tool remains available when the user names, asks about, or explicitly requests a skill, or when the model discovers a need after work has started.

The preflight is authoritative only for implicit auto-selection. It does not replace `load_skill` and does not infer a skill from inventory questions.

### 2. Preflight flow

For a non-empty new user message:

1. Apply any requested mode/profile changes already handled by `submitUserMessage()`.
2. Resolve the current mode.
3. Detect inventory questions and skip auto-selection for them. Inventory requests continue to use metadata-only handling and must not read `SKILL.md`.
4. Detect explicit skill intent and skip implicit preflight. The existing explicit `load_skill` behavior remains responsible for those requests.
5. Wait for `SkillsManager` readiness.
6. Get only `getSkillsForMode(currentMode)`.
7. Rank the user message against each skill's registered name and description using the pure resolver.
8. Apply the stricter implicit-selection threshold and winner margin.
9. On a clear match, load exactly that registered skill's content.
10. Store the loaded skill in task-local state and make its instructions available to the first model request.
11. On no match, continue normally.
12. On ambiguity, ask the user to clarify before sending the task to the model.

The preflight executes once per new user message before the initial request. Tool loops, retries, context condensation, and continuation requests reuse the task-local loaded-skill state and do not rerun automatic selection for the same message.

### 3. Applicability scoring

Reuse the existing pure resolver structure, but add an explicit mode for implicit applicability or a separate function with stricter thresholds. The implicit path must not weaken the existing explicit query behavior.

Initial implicit policy:

- minimum candidate score: `45`;
- minimum winner margin over the second candidate: `15`;
- only the top candidate is eligible for automatic loading;
- deterministic name ordering breaks exact score ties after ambiguity has been decided;
- a score below the threshold means no automatic skill;
- a margin below the threshold means ambiguity, not silent selection.

Matching uses only registered metadata:

- normalized skill name tokens;
- partial token overlap in the skill name;
- description token overlap;
- existing case-, separator-, and word-order-insensitive normalization.

The first implementation remains local and deterministic. It does not call an embedding provider or make a second AI request.

### 4. Explicit and inventory exclusions

The following must not be treated as implicit applicability requests:

- inventory questions such as `skill mu ada apa aja`, `what skills do you have`, or `list available skills`;
- explicit skill operations such as `pakai skill human writer`, `load human writer`, or `apakah ada skill human writer`.

Inventory handling remains metadata-only. It must not load a skill, request approval, inspect the filesystem, or call `loadSkillByQuery`.

Explicit skill operations continue through the existing `load_skill` path, including its approval, fuzzy resolution, ambiguity response, and registered-file safety rules.

### 5. Task-local loaded-skill state

Add the smallest task-local state needed to represent automatic activation. The state should record:

- the normalized user-message identity or preflight cycle identifier;
- the selected skill name, when one was loaded;
- whether preflight completed for that message;
- an optional short failure/ambiguity reason for diagnostics and adaptive state integration.

The state must be private to the existing `Task` instance. It must not be persisted as cross-task memory or copied into unrelated tasks.

Repeated calls caused by retries, tool results, or context restoration must consult this state and avoid loading the same skill again. A genuinely new user message starts a new preflight cycle and may select a different skill.

### 6. Making instructions available to the model

When a clear match is loaded, expose the returned `SkillContent.instructions` through the existing task context construction rather than issuing a separate model request. The implementation should use one stable task-local integration point, such as the task's system-prompt/context settings or an equivalent existing instruction-content path.

The instructions must be inserted only after the skill has been selected and read successfully. The registered skill name and source metadata may be included for traceability, but the full path must not be derived from user input.

If the `SKILL.md` file disappears or cannot be read:

- record the failure for diagnostics/adaptive state;
- do not crash the entire task solely because automatic skill loading failed;
- continue the normal request without skill instructions.

### 7. Ambiguity behavior

If at least two candidates meet the implicit minimum score but the winner margin is less than `15`, do not load either skill and do not send the original task to the model. Ask a concise clarification question listing the strongest candidate names and descriptions.

The clarification must be represented using the existing task/webview ask mechanism so the user can answer normally. The answer becomes a new user message and receives its own preflight cycle.

### 8. Interaction with existing adaptive state

The feature remains scoped to one Task and does not replace the existing adaptive task state. If useful for existing diagnostics, preflight may record:

- the selected skill as a completed setup step or current focus;
- ambiguity or file-read failure as a discovered issue.

It must not expand adaptive state into cross-task memory or introduce a separate orchestration service.

## Error Handling and Safety

- No arbitrary paths are accepted or constructed from the user message.
- Only skills returned by `getSkillsForMode(currentMode)` may be loaded.
- Readiness failures and missing files fall back to normal task execution after recording the issue.
- Ambiguous matches pause for clarification instead of guessing.
- Inventory requests never trigger skill-content reads.
- Automatic loading is limited to one skill per preflight cycle.
- Existing explicit `load_skill` approval and denial behavior remains unchanged.

## Testing Strategy

### Resolver tests

Add or extend pure resolver tests for implicit applicability:

- clear natural-language match against a description;
- match using partial name words and reversed order;
- generic request below the implicit threshold returns no match;
- near-tie returns ambiguity;
- clear winner with a weaker second candidate returns one match;
- deterministic ordering for equal scores.

### SkillsManager tests

Verify:

- mode filtering is applied before scoring/loading;
- readiness is awaited;
- only the selected registered path is read;
- missing `SKILL.md` returns a handled failure to the preflight caller;
- no filesystem scan occurs during resolution beyond normal manager readiness/discovery.

### Task lifecycle tests

Verify:

- a clear implicit request loads one skill before the first model request;
- the loaded instructions are available to that request;
- no-match requests proceed without skill content;
- ambiguous requests ask for clarification and do not send the original request;
- the same message does not load the skill again across retry/tool-loop paths;
- a new user message gets a fresh preflight decision;
- a load failure continues without skill instructions;
- inventory and explicit skill requests remain on their existing paths.

### Regression tests

Run the existing focused skill, prompt, task, and assistant-message suites, followed by backend typecheck and the repository's required build verification. Preserve unrelated working-tree changes and do not commit or push unless explicitly requested.

## Acceptance Criteria

- A clear implicit request automatically loads exactly one relevant skill before the first model request.
- A generic request does not load an unrelated skill.
- An ambiguous request asks for clarification rather than guessing.
- Inventory requests continue to return metadata without approval or `SKILL.md` loading.
- Explicit skill requests continue to use `load_skill`.
- Skill loading remains safe, mode-scoped, task-local, and deterministic.
- Existing adaptive task behavior and unrelated local changes remain intact.
