import type { AdaptiveTaskState } from "../../task/adaptiveTaskState"
import { formatAdaptiveTaskStateData } from "../../task/adaptiveTaskState"

export function getAdaptiveTaskStateSection(state: AdaptiveTaskState): string {
	return `# TASK STATE
Use the task state as working memory, not as a replacement for reading the repository.
Before each action, identify one concrete next step.
After every tool result, determine whether it advanced the objective.
When a tool fails, analyze the failure and choose a genuinely different approach instead of repeating the ineffective call.
When requirements are ambiguous or an action is risky, ask the user instead of guessing.
Before attempt_completion, inspect the relevant diff, run appropriate verification, and confirm that the objective and applicable todo items are satisfied.

<task_state>
${formatAdaptiveTaskStateData(state)}
</task_state>`
}
