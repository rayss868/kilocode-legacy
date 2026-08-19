# Implicit Skill Auto-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically load one clearly applicable registered skill before the first model request for a new user message, while preserving explicit `load_skill`, inventory behavior, task-local scope, and safe fallback behavior.

**Architecture:** Add a deterministic implicit-applicability path beside the existing explicit skill-query path. `Task.submitUserMessage()` runs one preflight before posting the user message; a pure resolver ranks only mode-filtered metadata using stricter implicit thresholds (`45` minimum score and `15` winner margin); a clear winner loads its registered `SKILL.md`, ambiguity asks for clarification, and no-match proceeds normally. Store the result and loaded instructions on the existing `Task` instance so retries and tool loops reuse it without rerunning or reloading.

**Tech Stack:** TypeScript, Vitest, VS Code extension host, existing `Task`, `SkillsManager`, `skillResolver`, and prompt/context construction.

## Global Constraints

- Preserve all unrelated working-tree changes, especially existing `ClineProvider.ts` and test modifications.
- Automatic selection loads at most one skill per preflight cycle and never multiple skills.
- Use only skills returned by `SkillsManager.getSkillsForMode(currentMode)`; never derive arbitrary paths from user text.
- Use local deterministic metadata matching only; do not add embeddings, extra model requests, subagents, verifier agents, cross-task memory, model routing, or orchestration services.
- Inventory requests remain metadata-only and must not load `SKILL.md`, request approval, or call `loadSkillByQuery`.
- Explicit skill requests continue through the existing `load_skill` path and its approval/ambiguity behavior.
- Implicit applicability threshold is `45`; clear-winner margin is `15`.
- A missing or unreadable `SKILL.md` records the failure and continues the normal task without skill instructions.
- Ambiguous implicit matches ask for clarification before sending the original request to the model.
- Run backend tests from `src`; do not run Vitest from repository root.
- Do not commit or push during implementation.

---

## File Map

- Modify `src/services/skills/skillResolver.ts` — expose a separate strict applicability resolver or configurable scoring entry point without changing explicit-query semantics.
- Modify `src/services/skills/SkillsManager.ts` — expose mode-scoped applicability and safe content-loading behavior to the task preflight.
- Create or modify `src/services/skills/__tests__/skillResolver.spec.ts` — cover strict implicit scoring and ambiguity.
- Modify `src/services/skills/__tests__/SkillsManager.spec.ts` — cover mode filtering, readiness, and missing-file fallback contract.
- Modify `src/core/task/Task.ts` — add task-local preflight state, execute preflight from `submitUserMessage`, inject loaded instructions into existing request context, and ask clarification on ambiguity.
- Modify `src/core/task/__tests__/Task.spec.ts` or create `src/core/task/__tests__/implicitSkillAutoselection.spec.ts` — cover lifecycle ordering, one-time loading, clarification, fallback, and exclusions using the existing Task test mocks.
- Inspect and modify the existing prompt/context construction only if the task-local skill instructions cannot be passed through the current `getSystemPrompt`/request path without a focused change; do not refactor unrelated prompt code.

---

### Task 1: Add pure implicit-applicability resolver behavior

**Files:**
- Modify: `src/services/skills/skillResolver.ts`
- Test: `src/services/skills/__tests__/skillResolver.spec.ts`

**Interfaces:**
- Consumes: existing `SkillMetadata`, `normalizeSkillQuery`, and `resolveSkillQuery` scoring behavior.
- Produces: a strict applicability function with a stable result contract, for example:

```ts
export type SkillApplicabilityResult =
  | { status: "matched"; match: RankedSkillMatch; alternatives: RankedSkillMatch[] }
  | { status: "ambiguous"; matches: RankedSkillMatch[] }
  | { status: "not_found"; matches: RankedSkillMatch[] }

export function resolveSkillApplicability(
  request: string,
  skills: SkillMetadata[],
): SkillApplicabilityResult
```

- The implementation may share private ranking helpers with `resolveSkillQuery`, but the existing explicit resolver contract and thresholds must remain unchanged.

- [ ] **Step 1: Write failing resolver tests for implicit matching**

Add tests that establish the stricter policy:

```ts
it("matches a clear natural-language request to a skill description", () => {
  const result = resolveSkillApplicability(
    "Buat artikel dengan bahasa natural yang terasa ditulis manusia",
    [humanWriter, codeReviewer],
  )

  expect(result).toMatchObject({
    status: "matched",
    match: { skill: { name: "human-like-writer" } },
  })
})

it("does not auto-select a skill for a generic request", () => {
  expect(resolveSkillApplicability("Buat tulisan yang bagus", [humanWriter])).toMatchObject({
    status: "not_found",
  })
})

it("returns ambiguity when strong candidates are within the implicit margin", () => {
  const result = resolveSkillApplicability("natural technical documentation", [technicalWriter, humanWriter])

  expect(result.status).toBe("ambiguous")
})

it("returns a clear winner when the second candidate is at least 15 points behind", () => {
  const result = resolveSkillApplicability("natural human-sounding prose", [humanWriter, codeReviewer])

  expect(result).toMatchObject({
    status: "matched",
    match: { skill: { name: "human-like-writer" } },
  })
})

it("keeps deterministic ordering for equal-score alternatives", () => {
  const first = resolveSkillApplicability("natural prose", [humanWriter, proseWriter])
  const second = resolveSkillApplicability("natural prose", [proseWriter, humanWriter])

  expect(first).toEqual(second)
})
```

Use the existing fixture style in `skillResolver.spec.ts`; choose descriptions that make the expected score and ambiguity explicit instead of relying on exact skill-name matches.

- [ ] **Step 2: Run the focused resolver tests and verify failure**

Run from the backend workspace:

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts services/skills/__tests__/skillResolver.spec.ts
```

Expected: FAIL because `resolveSkillApplicability` does not exist or does not yet enforce the strict threshold/margin.

- [ ] **Step 3: Implement the minimal strict resolver**

Refactor only the shared ranking needed to support two policies. Keep explicit behavior at its existing values (`20` minimum and `10` margin). Add constants for implicit behavior:

```ts
const IMPLICIT_MINIMUM_MATCH_SCORE = 45
const IMPLICIT_CLEAR_WINNER_MARGIN = 15
```

The applicability function must:

1. normalize the request with the existing case/separator/word-order normalization;
2. rank registered metadata by name and description evidence;
3. discard scores below `45`;
4. return `not_found` when no candidate remains;
5. return `ambiguous` when the top two qualifying scores differ by less than `15`;
6. return only the deterministic top match plus alternatives otherwise.

Do not load files, access VS Code, or inspect directories in this pure module.

- [ ] **Step 4: Run resolver tests and the existing explicit resolver tests**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts services/skills/__tests__/skillResolver.spec.ts
```

Expected: all resolver tests pass, including the pre-existing explicit-query tests.

---

### Task 2: Expose safe applicability loading through SkillsManager

**Files:**
- Modify: `src/services/skills/SkillsManager.ts`
- Test: `src/services/skills/__tests__/SkillsManager.spec.ts`

**Interfaces:**
- Consumes: `resolveSkillApplicability`, `getSkillsForMode`, `waitUntilReady`, and `getSkillContent`.
- Produces:

```ts
async resolveSkillApplicability(
  request: string,
  currentMode: string,
): Promise<SkillApplicabilityResult>

async loadSkillContentByName(
  name: string,
  currentMode: string,
): Promise<SkillContent | null>
```

`loadSkillContentByName` must resolve the name only against the current mode's registered metadata before reading its registered path. If the existing `getSkillContent` contract already provides this exact safe behavior, reuse it and expose only the applicability wrapper.

- [ ] **Step 1: Write failing SkillsManager tests**

Add tests that verify:

```ts
it("waits for readiness and resolves only skills available in the current mode", async () => {
  const result = await skillsManager.resolveSkillApplicability(
    "write natural human-sounding prose",
    "code",
  )

  expect(result).toMatchObject({
    status: "matched",
    match: { skill: { name: "human-like-writer" } },
  })
})

it("loads only the selected registered skill content", async () => {
  const content = await skillsManager.loadSkillContentByName("human-like-writer", "code")

  expect(content?.name).toBe("human-like-writer")
  expect(content?.instructions).toContain("natural")
})

it("does not resolve a skill that is unavailable in the current mode", async () => {
  const result = await skillsManager.resolveSkillApplicability("code only", "ask")

  expect(result.status).toBe("not_found")
})
```

Use existing test setup/mocks for discovered metadata and file reads. Add a missing-file case asserting that the manager surfaces a handled read failure to the Task preflight caller without scanning another location.

- [ ] **Step 2: Run focused SkillsManager tests and verify failure**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts services/skills/__tests__/SkillsManager.spec.ts
```

Expected: FAIL because the applicability wrapper or selected-name loading method is not implemented.

- [ ] **Step 3: Implement the minimal manager wrappers**

Import the strict resolver and add the two methods. Both must await `waitUntilReady()` before reading mode-filtered metadata. The selected-name loader must use the existing registered metadata lookup and `gray-matter` parsing path; it must not accept a user-provided path or call discovery directly.

Preserve `resolveSkillQuery` and `loadSkillByQuery` for explicit `load_skill` requests. Do not change their approval or result semantics.

- [ ] **Step 4: Run SkillsManager tests and the resolver suite**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts \
  services/skills/__tests__/SkillsManager.spec.ts \
  services/skills/__tests__/skillResolver.spec.ts
```

Expected: all selected manager and resolver tests pass.

---

### Task 3: Add task-local preflight state and context integration tests

**Files:**
- Modify: `src/core/task/Task.ts`
- Test: `src/core/task/__tests__/Task.spec.ts` or create `src/core/task/__tests__/implicitSkillAutoselection.spec.ts`

**Interfaces:**
- Consumes: `SkillsManager.resolveSkillApplicability`, `SkillsManager.loadSkillContentByName`, `Task.submitUserMessage`, `Task.ask`, and the existing request/system-prompt path.
- Produces private Task methods with stable responsibilities:

```ts
private async preflightImplicitSkillSelection(
  text: string,
  provider: ClineProvider,
): Promise<"continue" | "awaiting_clarification">

private getActiveSkillInstructions(): string | undefined
```

The exact private names may follow existing style, but the behavior and state must match this contract.

- [ ] **Step 1: Add failing Task tests for clear match ordering**

Create focused tests with a minimal provider/SkillsManager mock. Assert that a clear implicit request loads one skill before `sendMessage`/the first request begins and that the loaded instructions are available to the request context:

```ts
it("loads a clear implicit skill before posting the user message", async () => {
  const loadSkillContentByName = vi.fn().mockResolvedValue({
    name: "human-like-writer",
    description: "Writes natural prose",
    path: "C:/skills/human-like-writer/SKILL.md",
    source: "global",
    instructions: "Use a natural, human voice.",
  })
  const provider = createProviderWithSkills({
    resolveSkillApplicability: vi.fn().mockResolvedValue({
      status: "matched",
      match: { skill: humanWriter, score: 80 },
      alternatives: [],
    }),
    loadSkillContentByName,
  })
  const task = createTask({ provider })

  await task.submitUserMessage("Write this naturally")

  expect(loadSkillContentByName).toHaveBeenCalledWith("human-like-writer", "code")
  expect(provider.postMessageToWebview).toHaveBeenCalledAfter(loadSkillContentByName)
  expect(task.getActiveSkillInstructionsForTest?.()).toContain("natural, human voice")
})
```

Use the repository's existing test utilities and avoid adding a production test-only API; if private state must be asserted, inspect the resulting system prompt/request payload instead.

- [ ] **Step 2: Run the focused Task test and verify failure**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts core/task/__tests__/implicitSkillAutoselection.spec.ts
```

Expected: FAIL because `submitUserMessage` currently posts immediately and has no automatic skill state/context.

- [ ] **Step 3: Add task-local state without changing the adaptive state contract**

Add private state on `Task` for the current preflight cycle, for example:

```ts
type ImplicitSkillPreflightState = {
  messageKey: string
  status: "pending" | "completed" | "clarification" | "failed"
  skillName?: string
  instructions?: string
  reason?: string
}
```

Initialize it empty. Reset it when a genuinely new user message is accepted. Do not persist it across tasks or add it to shared memory. Avoid storing the full user text if a bounded normalized key is sufficient.

- [ ] **Step 4: Implement preflight in `submitUserMessage`**

After mode/profile updates and before `TaskUserMessage`/`postMessageToWebview`, add this order:

1. obtain the provider's `SkillsManager`;
2. skip if there is no manager or the message is empty/image-only;
3. skip inventory and explicit skill-intent messages using the existing inventory/explicit detection logic or a small shared helper;
4. call the manager's applicability method with the current mode;
5. for `not_found`, mark preflight complete and continue;
6. for `matched`, call `loadSkillContentByName` for exactly the returned metadata name;
7. store instructions only when loading succeeds;
8. for a read failure, record the reason, mark failed, log it, and continue;
9. for `ambiguous`, call the existing `ask` mechanism with the top candidate names/descriptions, mark clarification, and return without posting the original message.

Do not call the preflight from `recursivelyMakeClineRequests`; that method handles retries/tool results and must reuse the task-local instructions.

- [ ] **Step 5: Integrate loaded instructions into the existing request context**

Find the current system-prompt/request construction used by the first request and retries (the `getSystemPrompt()`/request path around `Task.ts:4264` and the API request construction around `Task.ts:4428`, `4580`, and `4647`). Add the task-local skill instructions at one stable point so every request in the same Task sees the loaded instructions without re-reading the file.

The integration must:

- return the ordinary prompt unchanged when no skill is active;
- append a clearly delimited skill-instructions section when active;
- use the already loaded content, not a filesystem path or second manager load;
- remain present after context condensation/retry because it is task-local state used by prompt construction.

Do not modify unrelated system prompt sections or the existing metadata-based `<available_skills>` section.

- [ ] **Step 6: Run the focused Task tests and verify they pass**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts \
  core/task/__tests__/implicitSkillAutoselection.spec.ts \
  core/task/__tests__/Task.spec.ts
```

Expected: the new lifecycle tests pass. Any pre-existing unrelated Task mock failure should be recorded separately and must not be “fixed” by weakening the new assertions.

---

### Task 4: Implement ambiguity, fallback, one-time loading, and exclusions

**Files:**
- Modify: `src/core/task/Task.ts`
- Test: `src/core/task/__tests__/implicitSkillAutoselection.spec.ts`
- Test: `src/core/tools/__tests__/LoadSkillTool.spec.ts` if shared inventory/explicit helpers are changed

**Interfaces:**
- Consumes: Task preflight state and the manager/resolver contracts from Tasks 1–3.
- Produces: verified behavior for all preflight branches without changing explicit `load_skill` behavior.

- [ ] **Step 1: Write failing branch tests**

Add tests for each required branch:

```ts
it("asks for clarification and does not post an ambiguous request", async () => {
  provider.skillsManager.resolveSkillApplicability.mockResolvedValue({
    status: "ambiguous",
    matches: [
      { skill: technicalWriter, score: 60 },
      { skill: humanWriter, score: 55 },
    ],
  })

  await task.submitUserMessage("Write natural technical documentation")

  expect(provider.skillsManager.loadSkillContentByName).not.toHaveBeenCalled()
  expect(provider.postMessageToWebview).not.toHaveBeenCalled()
  expect(task.ask).toHaveBeenCalledWith(
    "followup",
    expect.stringContaining("technical-writer"),
  )
})

it("continues without skill instructions when SKILL.md cannot be read", async () => {
  provider.skillsManager.resolveSkillApplicability.mockResolvedValue(clearHumanWriterMatch)
  provider.skillsManager.loadSkillContentByName.mockRejectedValue(new Error("ENOENT"))

  await task.submitUserMessage("Write this naturally")

  expect(provider.postMessageToWebview).toHaveBeenCalled()
  expect(task.getSystemPrompt()).resolves.not.toContain("Use a natural, human voice")
})

it("does not load the same skill again on repeated preflight calls for one message", async () => {
  await task.submitUserMessage("Write this naturally")
  await task.submitUserMessage("Write this naturally")

  expect(provider.skillsManager.loadSkillContentByName).toHaveBeenCalledTimes(1)
})

it("does not auto-load for inventory or explicit skill requests", async () => {
  await task.submitUserMessage("skill mu ada apa aja")
  await task.submitUserMessage("pakai skill human writer")

  expect(provider.skillsManager.resolveSkillApplicability).not.toHaveBeenCalled()
})
```

Adjust the exact ask category/message to the existing `Task.ask` conventions. The key assertions are no silent skill choice, no original request post on ambiguity, no crash on read failure, one load per preflight cycle, and no interference with inventory/explicit paths.

- [ ] **Step 2: Run branch tests and verify failure**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts core/task/__tests__/implicitSkillAutoselection.spec.ts
```

Expected: FAIL for the newly covered ambiguity/fallback/repetition/exclusion cases before the implementation is complete.

- [ ] **Step 3: Implement branch behavior**

Use the existing ask/webview mechanism for clarification and keep the original text pending until the user answers. On a new answer, compute a new message key and run preflight again.

Use a bounded task-local state check to prevent duplicate loading. Do not treat tool-loop retries as new messages. Ensure a failed read is recorded but does not set an active instruction string.

For inventory and explicit detection, reuse the existing semantic patterns rather than duplicating broad filesystem-discovery logic. The inventory branch must remain metadata-only and the explicit branch must continue to let `load_skill` request approval/load content normally.

- [ ] **Step 4: Run all focused skill and Task tests**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts \
  services/skills/__tests__/skillResolver.spec.ts \
  services/skills/__tests__/SkillsManager.spec.ts \
  core/task/__tests__/implicitSkillAutoselection.spec.ts \
  core/task/__tests__/Task.spec.ts \
  core/tools/__tests__/LoadSkillTool.spec.ts
```

Expected: all new tests pass; unrelated known failures must remain isolated and reported accurately.

---

### Task 5: Verify prompt/context regressions and repository quality

**Files:**
- Modify: only files required by failing verification; do not broaden scope.
- Test: existing prompt, assistant-message, auto-approval, and skill suites.

**Interfaces:**
- Consumes: completed resolver, manager, and Task preflight behavior.
- Produces: verified compatibility with existing explicit `load_skill`, inventory handling, prompt metadata, and tool dispatch.

- [ ] **Step 1: Run the complete focused regression suite**

```bash
cd "D:/All_project/own/kilocode-legacy/src"
./node_modules/.bin/vitest run --config vitest.config.ts \
  services/skills/__tests__/skillResolver.spec.ts \
  services/skills/__tests__/SkillsManager.spec.ts \
  core/task/__tests__/implicitSkillAutoselection.spec.ts \
  core/task/__tests__/Task.spec.ts \
  core/tools/__tests__/LoadSkillTool.spec.ts \
  core/prompts/sections/__tests__/skills.spec.ts \
  core/prompts/__tests__/custom-system-prompt.spec.ts \
  core/prompts/__tests__/system-prompt.spec.ts \
  core/assistant-message/__tests__/presentAssistantMessage-load-skill.spec.ts
```

Expected: new and existing relevant suites pass. Snapshot changes are not expected unless the implementation changes the existing prompt registry; do not update snapshots merely to hide an unrelated failure.

- [ ] **Step 2: Run backend typecheck**

```bash
node "D:/All_project/own/kilocode-legacy/node_modules/.pnpm/typescript@5.8.3/node_modules/typescript/bin/tsc" \
  --noEmit \
  -p "D:/All_project/own/kilocode-legacy/src/tsconfig.json"
```

Expected: exit code `0`.

- [ ] **Step 3: Check the diff without changing unrelated work**

```bash
git diff --check
```

Expected: no new whitespace errors attributable to this feature. Existing line-ending warnings may remain as previously observed.

- [ ] **Step 4: Review the final change set**

Confirm manually:

- `submitUserMessage` is the only implicit preflight entry point;
- `recursivelyMakeClineRequests` does not rerun resolver/loading;
- only one skill can become active per preflight cycle;
- explicit `load_skill` and inventory guards still behave as before;
- missing `SKILL.md` cannot terminate the task;
- no new dependency, embedding, subagent, verifier, cross-task memory, model router, or orchestration service was added;
- existing local modifications remain intact.

No commit or push is performed.

---

## Execution Notes

Implement tasks in order. Each task has its own test cycle. If an existing mock prevents an unrelated suite from running, fix only the minimal test fixture required to exercise the new behavior and record any pre-existing failure rather than changing production behavior speculatively.

The final acceptance check is a clear implicit request such as:

```text
Buat artikel dengan bahasa yang natural dan terasa ditulis manusia.
```

which must load `human-like-writer` before the first model request when the resolver reports a clear match. A generic request such as `Buat tulisan yang bagus` must continue without automatic skill loading, and a near-tie must ask the user to choose rather than guessing.
