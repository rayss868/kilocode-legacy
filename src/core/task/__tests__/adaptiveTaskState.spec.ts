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

	it("returns a new state and preserves the original state", () => {
		const state = createAdaptiveTaskState("Fix the login timeout")
		const next = applyAdaptiveTaskEvent(state, {
			type: "phase_changed",
			phase: "planning",
			currentFocus: "Authentication flow",
			nextAction: "Inspect the timeout handling",
		})

		expect(next).not.toBe(state)
		expect(state.phase).toBe("understanding")
		expect(next).toMatchObject({
			phase: "planning",
			currentFocus: "Authentication flow",
			nextAction: "Inspect the timeout handling",
		})
	})

	it("deduplicates and bounds operational history", () => {
		let state = createAdaptiveTaskState("Fix the login timeout")
		state = applyAdaptiveTaskEvent(state, {
			type: "issue_discovered",
			issue: "test failed",
		})
		state = applyAdaptiveTaskEvent(state, {
			type: "issue_discovered",
			issue: "test failed",
		})

		for (let index = 0; index < 12; index++) {
			state = applyAdaptiveTaskEvent(state, {
				type: "issue_discovered",
				issue: `issue ${index}`,
			})
		}

		expect(state.discoveredIssues).toHaveLength(8)
		expect(state.discoveredIssues).not.toContain("test failed")
		expect(state.discoveredIssues.at(-1)).toBe("issue 11")
	})

	it("formats populated working-memory fields", () => {
		let state = createAdaptiveTaskState("Fix the login timeout")
		state = applyAdaptiveTaskEvent(state, {
			type: "phase_changed",
			phase: "planning",
			nextAction: "Inspect the authentication flow",
		})
		state = applyAdaptiveTaskEvent(state, {
			type: "objective_constraint_added",
			constraint: "Do not change the public API",
		})
		state = applyAdaptiveTaskEvent(state, {
			type: "step_completed",
			step: "Read the login handler",
		})
		state = applyAdaptiveTaskEvent(state, {
			type: "issue_discovered",
			issue: "Existing test fails",
		})

		const formatted = formatAdaptiveTaskStateData(state)

		expect(formatted).toContain("phase: planning")
		expect(formatted).toContain("objective: Fix the login timeout")
		expect(formatted).toContain("constraints: Do not change the public API")
		expect(formatted).toContain("completed steps: Read the login handler")
		expect(formatted).toContain("discovered issues: Existing test fails")
		expect(formatted).toContain("next action: Inspect the authentication flow")
	})
})
