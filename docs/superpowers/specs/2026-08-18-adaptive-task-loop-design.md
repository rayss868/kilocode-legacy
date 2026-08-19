# Adaptive Task Loop Design

## Goal

Make the primary Kilo Code agent more adaptive while executing a task. The agent should maintain a concise operational understanding of the current task, choose the next action from observed tool results, recover from failures without repeating ineffective actions, and perform a lightweight self-check before completion.

This design intentionally does not add a verifier agent, cross-task memory, model routing, or a new orchestration service.

## Scope and constraints

- State is scoped to one `Task` instance and is not persisted as user memory.
- Existing conversation history, todo list, tool protocol, loop detector, approvals, and context condensation remain the source of detailed history and execution behavior.
- The new state is a compact working-memory layer rendered into the existing system prompt.
- The primary agent remains responsible for planning, execution, recovery decisions, and self-checking.
- The host records observable lifecycle events and prevents completion only through existing completion rules; it does not independently judge semantic correctness.
- Existing uncommitted user changes must remain untouched.

## Adaptive task state

Add a task-local state with this shape:

```ts
type AdaptiveTaskPhase =
  | "understanding"
  | "planning"
  | "implementing"
  | "recovering"
  | "verifying"

type AdaptiveTaskState = {
  phase: AdaptiveTaskPhase
  objective: string
  constraints: string[]
  completedSteps: string[]
  discoveredIssues: string[]
  currentFocus?: string
  nextAction?: string
}
```

The initial `objective` is derived from the initial user task content and remains stable for the lifetime of the task. The remaining fields are operational state and may be updated as the task progresses.

The state must be bounded. Lists should be deduplicated and capped so a long-running task cannot grow the prompt indefinitely. The most recent actionable issues and completed steps should be retained when trimming.

## State lifecycle

1. **Task start**
   - Initialize `phase` to `understanding`.
   - Set `objective` from the initial user request.
   - Leave derived lists empty.
   - Ask the model to identify the first concrete discovery or planning step.

2. **Discovery and planning**
   - Move to `planning` after the initial understanding response or after the agent has enough repository context to choose an implementation path.
   - Keep the todo list as the detailed plan when the model creates one.
   - Use `currentFocus` and `nextAction` to expose only the immediate operational direction.

3. **Implementation**
   - Move to `implementing` when the agent begins changing files or executing implementation commands.
   - Record completed todo items as `completedSteps` when the todo state changes.
   - Update `nextAction` after tool results when the model provides a concrete next step.

4. **Recovery**
   - Move to `recovering` after a failed tool call, command failure, invalid edit, or loop intervention.
   - Add a concise, deduplicated description to `discoveredIssues`.
   - Prompt the model to inspect the failure and choose a materially different action instead of repeating the same call.
   - Return to `implementing` or `verifying` after a successful recovery step.

5. **Verification**
   - Move to `verifying` when the model requests `attempt_completion`.
   - Prompt the model to inspect the relevant diff, run appropriate tests or checks, and confirm the objective and todo state.
   - If existing completion validation rejects the attempt, return to `recovering` and retain the rejection reason.

6. **Completion**
   - Clear the active adaptive state only when the task completes or is disposed. No cross-task memory is created.

## Prompt integration

Extend the existing system prompt with a compact `TASK STATE` section. It should include:

- current phase;
- stable objective;
- constraints, if any;
- completed steps;
- recent discovered issues;
- current focus;
- next action.

Add operational guidance:

- Treat the task state as working memory, not as a replacement for reading the repository.
- Before each action, identify one concrete next step.
- After every tool result, determine whether it advanced the objective.
- When a tool fails, analyze the failure and choose a genuinely different approach rather than repeating the ineffective call.
- When requirements are ambiguous or an action is risky, ask the user instead of guessing.
- Before `attempt_completion`, inspect the relevant diff, run appropriate verification, and confirm that the objective and applicable todo items are satisfied.

The prompt must not claim that the host has verified semantic correctness. The self-check is an instruction to the primary model and uses the existing tools and completion flow.

## Observable event updates

Update adaptive state only at existing task lifecycle boundaries to minimize coupling:

- initial task creation and first user message;
- successful and failed tool execution;
- todo list updates;
- loop detection intervention;
- context condensation or restoration;
- `attempt_completion` request and completion rejection.

Tool result processing should record only concise metadata, not full tool output. Full details remain in conversation history. Failures should use the existing formatted tool/error result where possible.

## Recovery behavior

Recovery is guidance plus state, not a second agent. The existing loop intervention message should be supplemented by the task state so the model sees:

- the current failure category or issue;
- the number of recent recovery attempts, if already tracked by existing state;
- the requirement to change strategy;
- the option to re-read context, run a diagnostic, narrow the change, or ask the user when ambiguity is genuine.

Do not automatically retry the identical tool call. Existing repetition detection remains responsible for interrupting repeated calls. The adaptive state explains the failure and gives the model a better basis for choosing the next action.

## Context condensation and restoration

The adaptive state must survive context condensation within the lifetime of the task. When the system prompt is rebuilt after condensation, it must render the current state again. If task state persistence is needed for an existing task restore path, serialize only the bounded state alongside existing task metadata and tolerate missing state for older tasks by reconstructing a safe initial state from the task's first user message.

## Self-check behavior

When the model requests completion, the prompt should require a lightweight self-check:

1. Review the changed files or relevant diff.
2. Run the most appropriate available test, typecheck, lint, or command verification.
3. Confirm the original objective and applicable todo items.
4. Report remaining limitations rather than claiming success prematurely.

Existing completion checks continue to handle tool failures and open todos according to current settings. A rejected completion updates adaptive state to `recovering` with the rejection reason and allows the existing task loop to continue.

## Testing strategy

Add focused unit tests in the existing task test area for:

- initial state creation from the user request;
- bounded and deduplicated issue/step updates;
- phase changes after tool success and failure;
- loop intervention entering recovery;
- todo completion synchronization;
- completion request entering verification;
- rejected completion returning to recovery;
- state rendering in the system prompt;
- state availability after context condensation or task restoration;
- preserving existing local `ClineProvider` behavior and tests.

Tests should exercise state transitions through small public or test-visible methods rather than duplicating the entire API request loop where possible.

## Non-goals

- No separate verifier agent.
- No persistent user or project memory.
- No automatic model selection or model switching.
- No new task orchestration service.
- No semantic pass/fail engine outside the primary agent.
- No unrelated refactoring of the existing task loop.

## Success criteria

The change is successful when a task-local working state is consistently visible to the primary model, state reflects observable progress and failures, repeated failures lead to recovery guidance, context condensation does not erase operational state, and completion requests trigger a self-check without introducing a separate verifier or changing the existing rollback point.
