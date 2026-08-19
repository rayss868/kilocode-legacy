# Flexible Skill Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime `load_skill` tool with deterministic fuzzy matching so informal skill references such as `human writer` and `writer human` resolve the registered `human-like-writer` skill safely.

**Architecture:** Keep matching in a pure resolver with no filesystem/provider dependencies. `SkillsManager` applies readiness and mode filtering, then resolves a query and loads only the registered skill path; a `LoadSkillTool` exposes that operation through the existing BaseTool, prompt-tool registry, and assistant-message dispatcher. Prompt instructions make `load_skill` mandatory for explicit skill lookup/use requests, while ambiguous results require clarification.

**Tech Stack:** TypeScript, Vitest, Zod tool schemas, existing `BaseTool`/tool protocol architecture, `gray-matter` skill parsing, pnpm workspace scripts.

## Global Constraints

- Do not add cross-task memory, subagents, verifier agents, model routing, UI changes, or unrelated refactoring.
- Preserve existing local changes in `src/core/webview/ClineProvider.ts` and `src/core/webview/__tests__/ClineProvider.spec.ts`.
- Match only skills discovered and registered by `SkillsManager`; never construct arbitrary filesystem paths from user query text.
- Return `SKILL.md` as instruction text; never execute skill content as code.
- Keep skill state scoped to the existing task/provider lifecycle.
- Do not commit or push during implementation unless explicitly requested.
- Run tests from the workspace that owns the relevant `package.json`; backend tests run from `src`.

---

## File Map

**Create:**

- `src/services/skills/skillResolver.ts` — Pure normalization, scoring, ranking, and match-status logic.
- `src/services/skills/__tests__/skillResolver.spec.ts` — Resolver unit tests.
- `src/core/tools/LoadSkillTool.ts` — Runtime `load_skill` BaseTool implementation.
- `src/core/prompts/tools/load-skill.ts` — Tool description and XML example.
- `src/core/tools/__tests__/LoadSkillTool.spec.ts` — Tool execution tests.

**Modify:**

- `packages/types/src/tool.ts` — Add `load_skill` to the canonical tool-name list.
- `src/shared/tools.ts` — Add native args, legacy parameter typing, display name, read-group membership, and `load_skill` parameter name if needed by existing parameter unions.
- `src/services/skills/SkillsManager.ts` — Expose query resolution/loading through the resolver and readiness barrier.
- `src/services/skills/__tests__/SkillsManager.spec.ts` — Test mode-aware query loading, readiness, and missing-file behavior.
- `src/core/prompts/tools/index.ts` — Register the description in tool prompt generation and mode filtering.
- `src/core/prompts/sections/skills.ts` — Require `load_skill` for explicit skill lookup/use intent.
- `src/core/assistant-message/presentAssistantMessage.ts` — Import, describe, and dispatch `LoadSkillTool`.
- `src/core/prompts/sections/__tests__/skills.spec.ts` — Assert the mandatory `load_skill` guidance.
- `src/core/assistant-message/__tests__/presentAssistantMessage-*.spec.ts` or a focused new dispatcher test beside existing present-message tests — Verify `load_skill` dispatch without changing existing local provider tests.

---

### Task 1: Add the pure fuzzy skill resolver

**Files:**
- Create: `src/services/skills/skillResolver.ts`
- Test: `src/services/skills/__tests__/skillResolver.spec.ts`

**Interfaces:**
- Consumes: `SkillMetadata` from `src/shared/skills.ts`.
- Produces: `normalizeSkillQuery(query: string): string[]`, `resolveSkillQuery(query: string, skills: SkillMetadata[]): SkillMatchResult`.

Define these exported types in `skillResolver.ts`:

```ts
export type SkillMatchStatus = "matched" | "ambiguous" | "not_found"

export type RankedSkillMatch = {
  skill: SkillMetadata
  score: number
}

export type SkillMatchResult =
  | { status: "matched"; match: RankedSkillMatch; alternatives: RankedSkillMatch[] }
  | { status: "ambiguous"; matches: RankedSkillMatch[] }
  | { status: "not_found"; matches: RankedSkillMatch[] }
```

- [ ] **Step 1: Write failing resolver tests**

Cover exact and flexible name behavior with concrete metadata:

```ts
const humanWriter: SkillMetadata = {
  name: "human-like-writer",
  description: "Writes natural Indonesian and English prose",
  path: "/skills/human-like-writer/SKILL.md",
  source: "global",
}

it("matches a partial name regardless of word order and separators", () => {
  expect(resolveSkillQuery("writer human", [humanWriter]).status).toBe("matched")
  expect(resolveSkillQuery("human_writer", [humanWriter]).status).toBe("matched")
})
```

Also test exact normalized slug, capitalization/punctuation variants, description as only supporting evidence, deterministic ordering, no match, empty query, and a near-tie that returns `ambiguous` rather than selecting silently.

- [ ] **Step 2: Run the resolver tests and verify failure**

Run from the repository root using the local pnpm entrypoint if the shell does not expose `pnpm`:

```bash
node "C:/Users/rayss/AppData/Local/pnpm/.tools/pnpm/10.11.0/node_modules/pnpm/bin/pnpm.cjs" --dir "D:/All_project/own/kilocode-legacy" --dir src test services/skills/__tests__/skillResolver.spec.ts
```

Expected: FAIL because `skillResolver.ts` and its exports do not exist yet.

- [ ] **Step 3: Implement normalization and scoring minimally**

Implement normalization by lowercasing, replacing non-alphanumeric runs with spaces, splitting, removing empty tokens, and preserving a normalized joined form for exact comparisons. Score name evidence above description evidence. Require a minimum score. Mark a result ambiguous when the best candidate is not sufficiently ahead of the second candidate. Do not mutate the input array or metadata.

- [ ] **Step 4: Run resolver tests and verify they pass**

Run the same focused command. Expected: all resolver tests pass, including partial, reversed, separator, description-support, no-match, and ambiguity cases.

- [ ] **Step 5: Commit only if the user separately authorizes commits**

Do not create a commit by default. If authorization is later given, stage only the resolver and resolver test with a focused message such as `feat: add flexible skill query resolver`.

---

### Task 2: Integrate resolver and safe loading into SkillsManager

**Files:**
- Modify: `src/services/skills/SkillsManager.ts`
- Test: `src/services/skills/__tests__/SkillsManager.spec.ts`

**Interfaces:**
- Consumes: `resolveSkillQuery`, `SkillMatchResult`, and existing `SkillMetadata`/`SkillContent`.
- Produces:

```ts
async resolveSkillQuery(query: string, currentMode: string): Promise<SkillMatchResult>
async loadSkillByQuery(query: string, currentMode: string): Promise<SkillLoadResult>
```

Define the structured loader result near the manager or in a focused shared service type:

```ts
type SkillLoadResult =
  | { status: "loaded"; content: SkillContent; alternatives: RankedSkillMatch[] }
  | { status: "ambiguous"; matches: RankedSkillMatch[] }
  | { status: "not_found"; matches: RankedSkillMatch[] }
```

- [ ] **Step 1: Add failing manager tests**

Extend the existing `SkillsManager.spec.ts` setup and add tests that discover a skill, then verify:

```ts
const result = await skillsManager.loadSkillByQuery("writer human", "code")
expect(result.status).toBe("loaded")
if (result.status === "loaded") {
  expect(result.content.name).toBe("human-like-writer")
  expect(result.content.instructions).toContain("# Human Writer")
}
```

Add tests for mode filtering, readiness when `initialize()` has not yet been called, ambiguous results, empty query validation, and a registered skill whose file disappears before loading. The missing-file test must assert a clear rejected error/result and must not return stale instructions.

- [ ] **Step 2: Run manager tests and verify failure**

Run:

```bash
node "C:/Users/rayss/AppData/Local/pnpm/.tools/pnpm/10.11.0/node_modules/pnpm/bin/pnpm.cjs" --dir "D:/All_project/own/kilocode-legacy" --dir src test services/skills/__tests__/SkillsManager.spec.ts
```

Expected: FAIL because the query APIs do not exist.

- [ ] **Step 3: Implement manager APIs**

At the beginning of both APIs, call `await this.waitUntilReady()`. `resolveSkillQuery` must call `getSkillsForMode(currentMode)` and pass only that resolved list to the pure resolver. `loadSkillByQuery` must return ambiguous/not-found results without reading any file; for a clear match, load using the matched registered skill path and existing frontmatter parsing. Reject empty queries with a validation error. Do not change existing exact `getSkillContent(name, currentMode)` behavior except to reuse safe content parsing if that avoids duplication.

- [ ] **Step 4: Run manager tests and verify they pass**

Run the same focused command. Expected: existing manager tests plus the new query-loading tests pass. If the pre-existing `fs/promises.stat` mock failure appears in an unrelated Task suite, keep it separate and do not alter unrelated mocks in this task.

- [ ] **Step 5: Commit only if authorized**

Default: no commit. If authorized, stage only `SkillsManager.ts`, its tests, and the resolver dependency changes with `feat: load skills through flexible queries`.

---

### Task 3: Add canonical tool types and prompt metadata

**Files:**
- Modify: `packages/types/src/tool.ts`
- Modify: `src/shared/tools.ts`
- Modify: `src/core/prompts/tools/load-skill.ts`
- Modify: `src/core/prompts/tools/index.ts`

**Interfaces:**
- Consumes: `SkillLoadResult` through the eventual tool handler; existing `ToolName`, `NativeToolArgs`, `TOOL_GROUPS`, and `toolParamNames` patterns.
- Produces: canonical tool name `load_skill`, native arg `{ query: string }`, XML description, and read-group availability.

- [ ] **Step 1: Add type/description tests or extend existing prompt tool tests**

Assert that the generated tool set includes `load_skill`, its native schema requires `query`, and the description contains the flexible-query rule and XML example:

```ts
expect(getLoadSkillDescription()).toContain("<load_skill>")
expect(getLoadSkillDescription()).toContain("query")
expect(getLoadSkillDescription()).toContain("partial names")
```

- [ ] **Step 2: Run the focused prompt/type tests and verify failure**

Run the relevant prompt tests from `src`; if no existing test directly covers the registry, run the new focused test file created beside the prompt-tool tests. Expected: FAIL because `load_skill` is not a canonical tool and no description exists.

- [ ] **Step 3: Register the tool consistently**

Add `load_skill` to `packages/types/src/tool.ts` `toolNames`. Add `{ query: string }` to `NativeToolArgs`, add the legacy `LoadSkillToolUse` parameter typing, and ensure `query` is present in the existing parameter-name union. Add `load_skill: "load skills"` to `TOOL_DISPLAY_NAMES` and include it in the `read` group next to `read_file`. Add `getLoadSkillDescription()` and wire it through the same tool-description map/filter path as `fetch_instructions`. The description must state that query words may be partial, separator-insensitive, and out of order, and that the tool should be used for explicit skill lookup/use requests.

- [ ] **Step 4: Run focused tests and typecheck**

Run the prompt/type test and backend typecheck. Expected: the tool is accepted by parser schemas and appears only where the read tool group is available.

- [ ] **Step 5: Commit only if authorized**

Default: no commit. If authorized, stage only package type, shared tool registry, prompt description, and tests.

---

### Task 4: Implement the LoadSkillTool

**Files:**
- Create: `src/core/tools/LoadSkillTool.ts`
- Create: `src/core/tools/__tests__/LoadSkillTool.spec.ts`

**Interfaces:**
- Consumes: `BaseTool<"load_skill">`, `ToolCallbacks`, `Task`, and `SkillsManager.loadSkillByQuery`.
- Produces: a tool that parses both legacy `<query>` and native `{ query }` calls and pushes a structured human-readable result.

- [ ] **Step 1: Write failing tool tests**

Use a task/provider test double exposing a `SkillsManager` and test these exact outcomes:

```ts
it("returns loaded skill instructions for a flexible query", async () => {
  await tool.execute({ query: "human writer" }, task, callbacks)
  expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("human-like-writer"))
  expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("# Human Writer"))
})
```

Also test ambiguous output names every candidate and tells the model to ask the user, not-found output, empty query using `sayAndCreateMissingParamError`, readiness delegation, and missing-file error through `handleError`/tool-error conventions. Verify that the tool does not request arbitrary filesystem paths.

- [ ] **Step 2: Run the tool tests and verify failure**

Run:

```bash
node "C:/Users/rayss/AppData/Local/pnpm/.tools/pnpm/10.11.0/node_modules/pnpm/bin/pnpm.cjs" --dir "D:/All_project/own/kilocode-legacy" --dir src test core/tools/__tests__/LoadSkillTool.spec.ts
```

Expected: FAIL because `LoadSkillTool` does not exist or is not registered.

- [ ] **Step 3: Implement BaseTool behavior**

Create `LoadSkillTool extends BaseTool<"load_skill">` with:

```ts
readonly name = "load_skill" as const
parseLegacy(params: Partial<Record<string, string>>): { query: string }
async execute(params: { query: string }, task: Task, callbacks: ToolCallbacks): Promise<void>
```

Trim the query. On empty input, increment the same mistake/error state used by neighboring tools and call `task.sayAndCreateMissingParamError("load_skill", "query")`. Obtain the provider from `task.providerRef`, get its `SkillsManager`, use the current task mode, call `loadSkillByQuery`, and format each structured result. Follow existing approval and `pushToolResult` conventions for read-like tools; do not expose or accept a user-provided path.

- [ ] **Step 4: Run tool tests and verify they pass**

Run the same focused command. Expected: success, ambiguous, not-found, validation, readiness, and error behavior all pass.

- [ ] **Step 5: Commit only if authorized**

Default: no commit. If authorized, stage the tool and its tests.

---

### Task 5: Wire `load_skill` through prompt generation and assistant dispatch

**Files:**
- Modify: `src/core/assistant-message/presentAssistantMessage.ts`
- Modify: `src/core/prompts/sections/skills.ts`
- Modify: `src/core/prompts/sections/__tests__/skills.spec.ts`
- Modify: `src/core/assistant-message/__tests__/presentAssistantMessage-*.spec.ts` or create a focused dispatcher test in that directory.

**Interfaces:**
- Consumes: `loadSkillTool`, canonical `ToolName`, the prompt description from Task 3, and the tool implementation from Task 4.
- Produces: prompt and dispatcher paths that recognize and execute `load_skill` for XML and native protocols.

- [ ] **Step 1: Add failing prompt and dispatcher tests**

Extend the skill-section regression test:

```ts
expect(result).toContain("load_skill")
expect(result).toContain("explicitly asks whether a skill exists")
expect(result).toContain("partial")
expect(result).toContain("word order")
```

Add a dispatcher test with a `ToolUse<"load_skill">` block and mocked tool handler; assert the handler receives the same callbacks used by `read_file` and is called once. Cover native `{ query }` args and legacy `{ query: "..." }` params through the existing parser/dispatch path where practical.

- [ ] **Step 2: Run focused tests and verify failure**

Run the skills section and dispatcher tests from `src`. Expected: prompt assertions fail because the mandatory instructions do not name `load_skill`, and dispatcher assertions fail because the switch does not handle the new tool.

- [ ] **Step 3: Update prompt guidance**

In `getSkillsSection`, retain the existing metadata and readiness behavior but revise the mandatory check to explicitly require `load_skill` whenever the user asks whether a named skill exists or asks the agent to use, inspect, check, or follow one. State that the original wording should be passed as the query and that partial names, separators, capitalization, and reversed word order are supported. State that ambiguous results require a user clarification and that unrelated requests should not load a skill.

- [ ] **Step 4: Wire description and execution dispatch**

Import `loadSkillTool` in `presentAssistantMessage.ts`. Add a `toolDescription()` case that displays the query. Add a `case "load_skill"` beside `read_file`/`fetch_instructions` and call `.handle()` with the existing callbacks and `ToolUse<"load_skill">` assertion. Ensure the canonical name is recognized by XML/native parsers through the package type change from Task 3.

- [ ] **Step 5: Run focused tests and verify they pass**

Run the skills-section and dispatcher tests. Expected: prompt contains the mandatory runtime instruction and `load_skill` dispatch succeeds for both supported argument forms.

- [ ] **Step 6: Commit only if authorized**

Default: no commit. Preserve all existing user changes in `ClineProvider.ts` and its test; do not stage or rewrite those files as part of this task.

---

### Task 6: Complete integration verification

**Files:**
- Modify only test files if verification reveals a real regression in the new feature.
- Do not modify unrelated existing tests to hide pre-existing failures.

**Interfaces:**
- Consumes: resolver, manager, tool, prompt, and dispatcher implementations from Tasks 1–5.
- Produces: verified feature behavior and an accurate failure report if unrelated existing tests remain broken.

- [ ] **Step 1: Run focused skill and tool tests**

From `src`, run the resolver, SkillsManager, skills prompt, LoadSkillTool, and assistant-message dispatcher tests together. Expected: all new and directly affected tests pass.

- [ ] **Step 2: Run backend typecheck**

Run the repository's backend typecheck command from the appropriate workspace. Expected: exit code 0 with no new TypeScript errors for `load_skill`, native args, or dispatcher cases.

- [ ] **Step 3: Run formatting and diff checks**

Run:

```bash
git diff --check
```

Expected: no whitespace errors. Confirm `ClineProvider.ts` and its test retain the user's local changes.

- [ ] **Step 4: Run the applicable build**

Build the extension using the repository's available pnpm entrypoint and confirm the VSIX packages the new tool code. Do not install, publish, commit, or push unless separately requested.

- [ ] **Step 5: Verify runtime acceptance criteria**

Exercise the task flow with the query `apakah kamu ada skill human writer?`. Confirm the model calls `load_skill` with the free-form query, the resolver selects `human-like-writer`, and the returned answer is based on the loaded `SKILL.md`. Exercise a near-tie query and confirm the tool returns candidates for clarification rather than selecting silently.

- [ ] **Step 6: Report accurately**

Report focused test, typecheck, diff, and build outcomes separately. If the known unrelated `Task.spec.ts` mock failure remains, identify it as unrelated instead of claiming the complete backend suite passes.

---

## Plan Self-Review

- **Spec coverage:** Pure resolver is Task 1; mode-aware readiness and safe loading are Task 2; canonical types and registry are Task 3; runtime tool and structured errors are Task 4; prompt and dispatcher integration are Task 5; verification and regression handling are Task 6.
- **Placeholder scan:** No `TBD`, `TODO`, or unspecified “handle edge cases” steps are used. Commands, expected outcomes, interfaces, and test cases are explicit.
- **Type consistency:** `load_skill` is the canonical name in Tasks 3–5; native args are `{ query: string }`; manager API is `loadSkillByQuery(query, currentMode)`; tool calls that API and returns its discriminated result.
- **Scope check:** No subagent, verifier, cross-task memory, routing, UI, or unrelated provider refactor is included. Existing `ClineProvider` local changes are explicitly preserved.
