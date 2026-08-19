# Adaptive Task Loop Implementation Plan

> **Execution note:** Implement this plan inline in the existing Kilo Code workspace. The subagent-driven option in the generic header refers to the external development harness, not a Kilo Code runtime feature; do not add subagents as part of this work.

**Goal:** Add a bounded, task-local adaptive working state so the primary Kilo Code agent can understand the current objective, react to tool outcomes, recover from failures, and self-check before completion.

**Architecture:** Keep the adaptive state inside the existing `Task` instance. A pure state module will define bounded state transitions and formatting data; `Task` will update it at existing lifecycle boundaries; the existing system prompt will render it beside the todo list. Existing loop detection and completion validation remain in control, while the primary model receives clearer recovery and verification guidance.

**Tech Stack:** TypeScript, Vitest, existing `Task` orchestration, existing prompt generator, existing tool protocol, existing todo and completion tools.

## Global Constraints

- State is scoped to one `Task` instance and is not persisted as user memory.
- Existing conversation history, todo list, tool protocol, loop detector, approvals, and context condensation remain the source of detailed history and execution behavior.
- The new state is a compact working-memory layer rendered into the existing system prompt.
- The primary agent remains responsible for planning, execution, recovery decisions, and self-checking.
- The host records observable lifecycle events and prevents completion only through existing completion rules; it does not independently judge semantic correctness.
- Do not add a verifier agent, cross-task memory, model routing, or a new orchestration service.
- Preserve the existing uncommitted changes in `src/core/webview/ClineProvider.ts` and `src/core/webview/__tests__/ClineProvider.spec.ts`.
- Do not commit or discard any changes unless the user explicitly requests it.
- Run backend tests from `src/`; use the workspace's Vitest command directly rather than the root `pnpm test` wrapper.

---

### Task 1: Add the pure adaptive task state module

**Files:**
- Create: `src/core/task/adaptiveTaskState.ts`
- Create: `src/core/task/__tests__/adaptiveTaskState.spec.ts`

**Interfaces:**
- Produces `AdaptiveTaskPhase`, `AdaptiveTaskState`, `AdaptiveTaskEvent`, `createAdaptiveTaskState`, `applyAdaptiveTaskEvent`, and `formatAdaptiveTaskStateData` for the later `Task` and prompt integrations.
- Consumes only strings and small event objects; it must not import `Task`, VS Code, API handlers, or tools.

- [ ] **Step 1: Write failing tests for state initialization and bounded updates**

Add tests covering the exact public behavior:

```ts
import { describe, expect, it } from "vitest"
import {
  applyAdaptiveTaskEvent,
  createAdaptiveTaskState,
  formatAdaptiveTaskStateData,
} from "../adaptiveTaskState"

describe("adaptive task state", () => {
  it("initializes a stable objective in understanding phase", () => {
    expect(createAdaptiveTaskState("Fix the login timeout")).toEqual({
      phase: "understanding",
      objective: "Fix the login timeout",
      constraints: [],
      completedSteps: [],
      discoveredIssues: [],
    })
  })

  it("deduplicates and bounds operational history", () => {
    const state = createAdaptiveTaskState("Fix the login timeout")
    const next = applyAdaptiveTaskEvent(state, {
      type: "issue_discovered",
      issue: "test failed",
    })
    const repeated = applyAdaptiveTaskEvent(next, {
      type: "issue_discovered",
      issue: "test failed",
    })
    expect(repeated.discoveredIssues).toEqual(["test failed"])
  })

  it("formats only populated working-memory fields", () => {
    const state = applyAdaptiveTaskEvent(createAdaptiveTaskState("Fix the login timeout"), {
      type: "phase_changed",
      phase: "planning",
      nextAction: "Inspect the authentication flow",
    })
    expect(formatAdaptiveTaskStateData(state)).toContain("planning")
    expect(formatAdaptiveTaskStateData(state)).toContain("Inspect the authentication flow")
  })
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `src/`:

```bash
pnpm exec vitest run core/task/__tests__/adaptiveTaskState.spec.ts
```

Expected: FAIL because `adaptiveTaskState.ts` and its exports do not exist yet.

- [ ] **Step 3: Implement the bounded state API**

Create the phase union and state shape from the approved spec. Define events for the observable transitions needed by `Task`:

```ts
export type AdaptiveTaskEvent =
  | { type: "phase_changed"; phase: AdaptiveTaskPhase; currentFocus?: string; nextAction?: string }
  | { type: "step_completed"; step: string }
  | { type: "issue_discovered"; issue: string }
  | { type: "objective_constraint_added"; constraint: string }
  | { type: "focus_changed"; currentFocus?: string; nextAction?: string }
```

`applyAdaptiveTaskEvent` must return a new state object, never mutate its input, preserve the original objective, deduplicate list entries, and retain only the most recent bounded entries. Use one explicit constant for the list cap so the test can assert the behavior without relying on prompt length.

`formatAdaptiveTaskStateData` should return a compact data string or empty string for no state. It must include phase and objective and include optional lists/focus/action only when populated. It must not include full tool output or conversation history.

- [ ] **Step 4: Run the focused test to verify it passes**

```bash
pnpm exec vitest run core/task/__tests__/adaptiveTaskState.spec.ts
```

Expected: PASS for initialization, immutability, deduplication/bounding, transitions, and formatting.

---

### Task 2: Integrate adaptive state into `Task` lifecycle

**Files:**
- Modify: `src/core/task/Task.ts:1-120` for imports and `228-250`, `521-681` for state initialization
- Modify: `src/core/task/Task.ts:2685-2720` for loop phase transitions
- Modify: `src/core/task/Task.ts:2987-2993` and tool-result handling around `3965-3978` for event updates
- Modify: `src/core/task/Task.ts:4193-4296` for prompt-state passing
- Modify: `src/core/task/__tests__/Task.spec.ts` for task-level state behavior

**Interfaces:**
- Consumes the pure state API from `src/core/task/adaptiveTaskState.ts`.
- Produces `Task.adaptiveTaskState` and small methods such as `getAdaptiveTaskState()`, `setAdaptiveTaskPhase(...)`, `recordAdaptiveTaskIssue(...)`, `recordAdaptiveTaskStep(...)`, and `syncAdaptiveTaskStateFromTodos()` for tools and prompt generation.

- [ ] **Step 1: Add failing Task tests for initialization and lifecycle updates**

In the existing `Task.spec.ts` test setup, add focused tests using the existing task factory/mocks. Assert that:

```ts
expect(task.getAdaptiveTaskState()).toMatchObject({
  phase: "understanding",
  objective: initialTaskText,
})

await task.setAdaptiveTaskPhase("recovering")
task.recordAdaptiveTaskIssue("command failed")
expect(task.getAdaptiveTaskState()).toMatchObject({
  phase: "recovering",
  discoveredIssues: ["command failed"],
})
```

Also test that a task created from a history item reconstructs a safe initial state with the history item's task text, rather than throwing or producing an empty objective.

- [ ] **Step 2: Run the focused Task tests to verify the new assertions fail**

```bash
pnpm exec vitest run core/task/__tests__/Task.spec.ts
```

Expected: FAIL only for the new adaptive-state assertions because the Task API is not implemented yet.

- [ ] **Step 3: Initialize and expose bounded state on `Task`**

Add a private or public task-local `adaptiveTaskState` field initialized from `this.metadata.task` after metadata is assigned. Use the same initialization path for new tasks and history tasks. Add the accessors/mutators listed in the Interfaces block; each mutator must delegate to `applyAdaptiveTaskEvent` and replace the state immutably.

Implement `syncAdaptiveTaskStateFromTodos()` to derive completed step descriptions from the current `todoList`, preserving existing state entries and allowing an empty todo list without throwing. Keep the state in memory only; do not add a new persistence format or modify the `ClineProvider` changes already in the working tree.

- [ ] **Step 4: Wire lifecycle events at existing boundaries**

Update the existing loop without changing its retry/abort semantics:

- At `initiateTaskLoop`, transition to `planning` before the first request and to `implementing` when the task begins acting on tool results.
- In the existing tool failure path, call `recordAdaptiveTaskIssue` with the formatted short error and transition to `recovering`.
- In the existing loop intervention block, record a concise repetition issue and transition to `recovering`; retain the current intervention message and `say` call.
- After successful tool processing, keep the current phase and update `currentFocus`/`nextAction` only from concise data already available to the host; do not copy full tool output into state.
- When a new request starts, keep the existing per-turn resets and do not reset adaptive state.

- [ ] **Step 5: Pass the live state into `getSystemPrompt()`**

When `Task.getSystemPrompt()` builds `SystemPromptSettings`, pass the current adaptive state as an optional setting. This ensures every prompt rebuild, including after condensation or forced truncation, sees the same operational state. Use the existing `this.todoList` path unchanged.

- [ ] **Step 6: Run the focused tests to verify the Task integration passes**

```bash
pnpm exec vitest run core/task/__tests__/Task.spec.ts core/task/__tests__/adaptiveTaskState.spec.ts
```

Expected: PASS, with the pre-existing Task tests remaining green.

---

### Task 3: Render adaptive state and guidance in the system prompt

**Files:**
- Modify: `src/core/prompts/types.ts:6-17` to add the optional state setting
- Create: `src/core/prompts/sections/adaptive-task-state.ts`
- Modify: `src/core/prompts/system.ts:24-40`, `56-194`, and `197-296`
- Create or modify: `src/core/prompts/__tests__/system.spec.ts` for prompt rendering tests

**Interfaces:**
- Consumes `AdaptiveTaskState` from `src/core/task/adaptiveTaskState.ts` through a type-only import and the formatter from the prompt section.
- Produces an optional `adaptiveTaskState` field on `SystemPromptSettings` and a stable `TASK STATE` prompt section used by both normal and file-based system-prompt paths.

- [ ] **Step 1: Write failing prompt tests**

Add a focused test around the existing system prompt generator or the new section formatter. Verify that a populated state produces all required guidance and state data:

```ts
expect(prompt).toContain("TASK STATE")
expect(prompt).toContain("Treat the task state as working memory")
expect(prompt).toContain("Fix the login timeout")
expect(prompt).toContain("When a tool fails")
expect(prompt).toContain("Before attempt_completion")
```

Add a second assertion that empty optional arrays do not create a large empty block and that file-based custom prompts still receive the task-state section.

- [ ] **Step 2: Run the focused prompt tests to verify they fail**

```bash
pnpm exec vitest run core/prompts/__tests__/system.spec.ts
```

Expected: FAIL because the setting and section are not implemented.

- [ ] **Step 3: Implement the prompt section and setting**

Add `adaptiveTaskState?: AdaptiveTaskState` to `SystemPromptSettings`. Create `getAdaptiveTaskStateSection(state)` that renders the formatted state plus these concise instructions:

```text
Use the task state as working memory, not as a replacement for reading the repository.
Before each action, identify one concrete next step.
After every tool result, determine whether it advanced the objective.
When a tool fails, analyze the failure and choose a genuinely different approach instead of repeating the ineffective call.
When requirements are ambiguous or an action is risky, ask the user instead of guessing.
Before attempt_completion, inspect the relevant diff, run appropriate verification, and confirm that the objective and applicable todo items are satisfied.
```

Insert the section near the existing objective/todo section. Keep it compact and ensure the formatter never claims that the host independently verified semantic correctness.

For file-based custom system prompts, append the same task-state section and guidance before returning so context condensation cannot remove the state from that path.

- [ ] **Step 4: Pass the setting through all prompt call sites**

Update the `SYSTEM_PROMPT`/`generatePrompt` signatures only as needed to use `settings?.adaptiveTaskState`. Update `Task.getSystemPrompt()` to provide it. Preserve all existing argument order behavior for callers that do not set the optional field.

- [ ] **Step 5: Run prompt and task regression tests**

```bash
pnpm exec vitest run core/prompts/__tests__/system.spec.ts core/task/__tests__/Task.spec.ts
```

Expected: PASS, including existing custom prompt, todo, skills, and system prompt behavior.

---

### Task 4: Connect todo, recovery, completion, and context rebuild behavior

**Files:**
- Modify: `src/core/tools/UpdateTodoListTool.ts:82-89` to synchronize completed steps
- Modify: `src/core/tools/AttemptCompletionTool.ts:75-105` and `107-199` for verification/rejection transitions
- Modify: `src/core/task/Task.ts:1835-1923` and `4307-4400` only where state visibility needs explicit regression coverage
- Modify: `src/core/task/__tests__/Task.spec.ts`
- Create or modify: `src/core/tools/__tests__/AttemptCompletionTool.spec.ts` if the existing tool test location is present

**Interfaces:**
- Consumes `Task` adaptive-state methods from Task 2.
- Produces observable phase transitions: todo completion updates steps, completion attempts enter `verifying`, existing completion rejection returns to `recovering`, and prompt rebuilds retain state.

- [ ] **Step 1: Write failing tests for todo and completion transitions**

Add tests that exercise existing tool callbacks with a task double or the established tool-test harness:

```ts
await setTodoListForTask(task, [{ id: "1", content: "Run tests", status: "completed" }])
task.syncAdaptiveTaskStateFromTodos()
expect(task.getAdaptiveTaskState().completedSteps).toContain("Run tests")

await task.markAdaptiveCompletionRequested()
expect(task.getAdaptiveTaskState().phase).toBe("verifying")

task.markAdaptiveCompletionRejected("Cannot complete task while there are incomplete todos")
expect(task.getAdaptiveTaskState()).toMatchObject({
  phase: "recovering",
  discoveredIssues: ["Cannot complete task while there are incomplete todos"],
})
```

Cover both completion rejection paths already present: a failed tool in the current turn and incomplete todos when the setting blocks completion.

- [ ] **Step 2: Run the focused tests to verify they fail**

```bash
pnpm exec vitest run core/task/__tests__/Task.spec.ts core/tools/__tests__/AttemptCompletionTool.spec.ts
```

Expected: FAIL for the new state transition assertions only.

- [ ] **Step 3: Synchronize todo state after approved todo updates**

After `setTodoListForTask` succeeds in `UpdateTodoListTool.execute`, call `task.syncAdaptiveTaskStateFromTodos()`. Do not alter todo approval, parsing, validation, or user-edit behavior.

- [ ] **Step 4: Mark completion verification and rejection in the existing completion tool**

At the beginning of `AttemptCompletionTool.execute`, call `task.markAdaptiveCompletionRequested()` before existing validation. On each existing rejection path, call `task.markAdaptiveCompletionRejected(reason)` before returning. Keep all existing error messages, counters, tool results, delegation behavior, user approval behavior, telemetry, and completion events unchanged.

Do not add semantic acceptance logic to the tool. The model remains responsible for the self-check; the host only records the observable transition and preserves current completion guards.

- [ ] **Step 5: Verify state survives context rebuilding**

Use the existing `Task.getSystemPrompt()` and `condenseContext()` test/mocking patterns to assert that after a prompt rebuild the rendered prompt still contains the same objective, current phase, and recent issue. Do not require conversation history to contain the adaptive state; the live Task state is the source for prompt regeneration.

- [ ] **Step 6: Run the focused integration tests**

```bash
pnpm exec vitest run core/task/__tests__/Task.spec.ts core/task/__tests__/adaptiveTaskState.spec.ts core/prompts/__tests__/system.spec.ts core/tools/__tests__/AttemptCompletionTool.spec.ts
```

Expected: PASS, including existing completion, todo, loop detector, and context-management regressions.

---

### Task 5: Run the complete backend verification and review the diff

**Files:**
- Modify only the adaptive-loop files from Tasks 1-4.
- Preserve: `src/core/webview/ClineProvider.ts` and `src/core/webview/__tests__/ClineProvider.spec.ts` existing user changes.

- [ ] **Step 1: Run the affected test suite**

From `src/`:

```bash
pnpm exec vitest run core/task core/prompts core/tools
```

Expected: PASS for all affected backend tests.

- [ ] **Step 2: Run type checking for the backend workspace**

From the workspace directory that owns the relevant TypeScript configuration, run the repository's backend typecheck command and resolve only errors caused by the adaptive-loop changes. Do not disable lint or type rules.

- [ ] **Step 3: Inspect the final diff and working tree**

```bash
git diff --check
git diff -- src/core/task src/core/prompts src/core/tools
git status --short
```

Confirm that the diff contains no edits to the existing `ClineProvider` changes, no generated files, no cross-task memory, no verifier agent, and no unrelated refactor.

- [ ] **Step 4: Report verification accurately**

Summarize the implemented adaptive loop, list the exact tests/typecheck commands that passed, and explicitly mention any command that could not run or any pre-existing failure. Do not create a commit or push unless the user explicitly asks.

## Plan self-review

- **Spec coverage:** Task 1 covers the state shape, immutability, bounds, deduplication, and formatting. Task 2 covers Task-local lifecycle state, observable tool/loop events, and prompt-state plumbing. Task 3 covers system prompt integration and guidance, including file-based prompts. Task 4 covers todo synchronization, completion verification/rejection, and context rebuild behavior. Task 5 covers regression verification and preservation of the existing working tree.
- **Scope check:** No separate verifier, persistent memory, model routing, new orchestration service, or unrelated refactor is included.
- **Type consistency:** The state types and event API are introduced in Task 1, consumed by Task 2, passed through `SystemPromptSettings` in Task 3, and consumed by existing tools in Task 4.
- **Placeholder check:** Every implementation step names concrete files, methods or boundaries, tests, commands, and expected outcomes.
