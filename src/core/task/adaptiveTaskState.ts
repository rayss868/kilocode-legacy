export type AdaptiveTaskPhase =
	| "understanding"
	| "planning"
	| "implementing"
	| "recovering"
	| "verifying"

export type AdaptiveTaskState = {
	phase: AdaptiveTaskPhase
	objective: string
	constraints: string[]
	completedSteps: string[]
	discoveredIssues: string[]
	currentFocus?: string
	nextAction?: string
}

export type AdaptiveTaskEvent =
	| {
			type: "phase_changed"
			phase: AdaptiveTaskPhase
			currentFocus?: string
			nextAction?: string
	  }
	| { type: "step_completed"; step: string }
	| { type: "issue_discovered"; issue: string }
	| { type: "objective_constraint_added"; constraint: string }
	| { type: "focus_changed"; currentFocus?: string; nextAction?: string }

const MAX_OPERATIONAL_ENTRIES = 8

export function createAdaptiveTaskState(objective: string): AdaptiveTaskState {
	return {
		phase: "understanding",
		objective,
		constraints: [],
		completedSteps: [],
		discoveredIssues: [],
	}
}

export function applyAdaptiveTaskEvent(state: AdaptiveTaskState, event: AdaptiveTaskEvent): AdaptiveTaskState {
	switch (event.type) {
		case "phase_changed":
			return {
				...state,
				phase: event.phase,
				currentFocus: event.currentFocus ?? state.currentFocus,
				nextAction: event.nextAction ?? state.nextAction,
			}
		case "step_completed":
			return {
				...state,
				completedSteps: appendBoundedUnique(state.completedSteps, event.step),
			}
		case "issue_discovered":
			return {
				...state,
				discoveredIssues: appendBoundedUnique(state.discoveredIssues, event.issue),
			}
		case "objective_constraint_added":
			return {
				...state,
				constraints: appendBoundedUnique(state.constraints, event.constraint),
			}
		case "focus_changed":
			return {
				...state,
				currentFocus: event.currentFocus,
				nextAction: event.nextAction,
			}
	}
}

export function formatAdaptiveTaskStateData(state: AdaptiveTaskState): string {
	const lines = [`phase: ${state.phase}`, `objective: ${state.objective}`]

	if (state.constraints.length > 0) {
		lines.push(`constraints: ${state.constraints.join("; ")}`)
	}

	if (state.completedSteps.length > 0) {
		lines.push(`completed steps: ${state.completedSteps.join("; ")}`)
	}

	if (state.discoveredIssues.length > 0) {
		lines.push(`discovered issues: ${state.discoveredIssues.join("; ")}`)
	}

	if (state.currentFocus) {
		lines.push(`current focus: ${state.currentFocus}`)
	}

	if (state.nextAction) {
		lines.push(`next action: ${state.nextAction}`)
	}

	return lines.join("\n")
}

function appendBoundedUnique(values: string[], value: string): string[] {
	const normalizedValue = value.trim()
	if (!normalizedValue || values.includes(normalizedValue)) {
		return values
	}

	return [...values, normalizedValue].slice(-MAX_OPERATIONAL_ENTRIES)
}
