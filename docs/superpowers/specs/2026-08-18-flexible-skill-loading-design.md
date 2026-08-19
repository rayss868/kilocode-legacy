# Flexible Skill Discovery and Loading

## Status

Approved design for implementation planning.

## Goal

Make skill lookup reliable when a user refers to a skill informally, partially, or with words in a different order. A request such as `human writer`, `human_writer`, or `writer human` should be able to resolve the registered `human-like-writer` skill instead of causing the agent to incorrectly report that no skill exists.

## Scope

This change covers:

- Flexible matching of user queries against registered skill names and descriptions.
- A runtime `load_skill` tool that resolves and loads a selected skill's `SKILL.md`.
- Prompt instructions that require `load_skill` for explicit skill availability or skill-use requests.
- Ambiguity handling, mode filtering, readiness, and focused tests.

This change does not add cross-task memory, subagents, verifier agents, model routing, UI changes, skill execution as code, or unrelated refactoring. Skill state remains scoped to the existing task/provider lifecycle.

## Current Problem

`SkillsManager` discovers skill metadata and `getSkillsSection` includes that metadata in the system prompt. The model can use the general `read_file` tool to read a listed `SKILL.md`, but there is no dedicated runtime operation for resolving or loading a skill. The model therefore has to perform approximate matching and choose a file path itself. When the user says `human writer` while the registered skill is `human-like-writer`, it can incorrectly answer that the skill is unavailable without making a tool call.

`fetch_instructions` is not a skill loader. It only provides instructions for its existing supported tasks, such as creating modes or MCP servers.

## Design

### 1. Pure skill resolver

Add a focused resolver with no filesystem or provider dependencies. It accepts a free-form query and registered `SkillMetadata` records and returns ranked matches with a match status:

- `matched`: one clearly superior candidate.
- `ambiguous`: multiple candidates are close enough that automatic selection is unsafe.
- `not_found`: no candidate reaches the minimum score.

Normalization should:

- lowercase text;
- treat spaces, hyphens, underscores, and punctuation as separators;
- collapse repeated separators;
- tokenize both query and candidate fields;
- compare token sets without requiring the same order.

Scoring priorities:

1. exact normalized name;
2. all query tokens represented by the skill name, regardless of order;
3. partial token and substring overlap in the name;
4. description overlap as supporting evidence.

Name evidence must outweigh description-only evidence. A candidate below the minimum score is not selected. A candidate is auto-selected only when its score is sufficiently strong and its lead over the next candidate meets the configured margin. Otherwise the resolver returns the leading candidates as ambiguous.

The resolver must be deterministic and must not mutate metadata.

### 2. `SkillsManager` lookup and loading API

Expose a small API that keeps matching logic in one place. The API should:

- wait for skill discovery readiness;
- apply the existing current-mode filtering and override resolution;
- resolve a free-form query through the pure resolver;
- on a clear match, load the registered skill file through the existing skill-content path;
- return structured success, ambiguous, and not-found results.

The loader must use the registered skill path rather than constructing an arbitrary path from user input. It must not execute skill content. If the file disappears after discovery, return a clear tool error rather than silently using stale body content.

An empty or whitespace-only query is a validation error. Discovery and existing metadata error behavior remain unchanged.

### 3. `load_skill` runtime tool

Add a tool with a free-form query parameter:

```xml
<load_skill>
  <query>human writer</query>
</load_skill>
```

The handler obtains the active `SkillsManager` through the existing task/provider context and delegates resolution/loading to it. It returns:

- for a clear match: skill name, description, registered location, and `SKILL.md` instructions;
- for an ambiguous match: candidate names and locations, explicitly instructing the model to ask the user which skill they mean;
- for no match: a concise not-found result and useful near-match names when available;
- for invalid input or a missing file: a clear tool error.

The tool must be registered wherever tool names, descriptions, mode filtering, and assistant-message dispatch are defined. It should follow existing tool result, approval, and error conventions. It must not bypass existing mode restrictions.

### 4. Prompt integration

Extend the available-skills instructions so that:

- an explicit question about whether a skill exists invokes `load_skill` with the user's wording;
- a request to use, follow, inspect, or check a named skill invokes `load_skill` before answering or acting;
- matching is flexible across partial names, separators, capitalization, and word order;
- the model must not conclude that a skill is absent solely because the wording is not an exact slug;
- an ambiguous result requires clarification rather than silent selection;
- after a successful load, the model follows the returned skill instructions for the current task;
- unrelated tasks do not cause arbitrary skills to be loaded.

`read_file` remains available for normal repository work and is not removed. The prompt should identify `load_skill` as the preferred path for registered skills.

### 5. Tests

Add or update tests for:

- exact normalized name matching;
- partial name matching such as `human writer`;
- reversed token order such as `writer human`;
- hyphen, underscore, spacing, capitalization, and punctuation variants;
- description as supporting evidence;
- deterministic ranking;
- near-tie ambiguity and clear winner selection;
- no-match and empty-query results;
- mode filtering and readiness waiting;
- successful `SKILL.md` loading through a registered path;
- missing skill file after discovery;
- `load_skill` success, ambiguous, not-found, and validation results;
- prompt instructions requiring `load_skill` for explicit skill queries;
- regression that unrelated requests do not load a skill.

Preserve existing local changes in `ClineProvider.ts` and its tests.

## Data Flow

```text
User request
  -> model identifies explicit skill lookup/use intent
  -> load_skill(query)
  -> active task/provider SkillsManager
  -> waitUntilReady()
  -> getSkillsForMode(currentMode)
  -> pure fuzzy resolver
  -> clear match: load registered SKILL.md and return content
  -> ambiguous: return candidates and require clarification
  -> not found: return status and near matches
  -> model answers or acts using the loaded instructions
```

## Verification Criteria

The feature is successful when a request such as `apakah kamu ada skill human writer?` causes the agent to call `load_skill` with the free-form query, resolves `human-like-writer`, and answers using the loaded `SKILL.md`. A query with two materially similar registered skills must return ambiguity instead of silently selecting one.

Before completion, run the focused skill/resolver/tool tests, backend typecheck, `git diff --check`, and the applicable build verification. Report any pre-existing unrelated failures separately and do not claim the full suite passes if it does not.

## Out of Scope

- Creating or editing skills.
- Running skill content as executable code.
- Cross-task or persistent skill memory.
- New subagent or verifier-agent infrastructure.
- Automatic model routing.
- UI redesign or new skill settings.
- Replacing the existing skill discovery mechanism.
