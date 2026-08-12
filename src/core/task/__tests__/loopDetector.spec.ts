import { describe, expect, it } from "vitest"

import type { AssistantMessageContent } from "../../assistant-message"
import { LoopDetector } from "../loopDetector"

function toolUse(name: string, params: Record<string, string> = {}): AssistantMessageContent {
	return { type: "tool_use", id: `id-${name}`, name: name as any, params } as any
}

function mcpToolUse(name: string, args: Record<string, unknown> = {}): AssistantMessageContent {
	return { type: "mcp_tool_use", serverName: "test-server", name, arguments: args } as any
}

function textMessage(text: string): AssistantMessageContent {
	return { type: "text", content: text, partial: false }
}

describe("LoopDetector", () => {
	it("does nothing on a single tool call", () => {
		const detector = new LoopDetector(3, 2)
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
	})

	it("does nothing when the model varies its tool calls", () => {
		const detector = new LoopDetector(3, 2)
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/b.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/c.txt" })])).toBeUndefined()
	})

	it("intervenes exactly on the maxRepeats-th identical call", () => {
		const detector = new LoopDetector(3, 2)
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBe("intervene")
	})

	it("re-arms after an intervention: needs a fresh run of identical calls", () => {
		const detector = new LoopDetector(3, 2)
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBe("intervene")
		// counter reset after intervening
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBe("intervene")
	})

	it("stops once all interventions are spent", () => {
		const detector = new LoopDetector(3, 2)
		// intervention #1 on the 3rd call
		for (let i = 0; i < 3; i++) {
			detector.update([toolUse("execute_command", { command: "npm test" })])
		}
		// intervention #2 on the next 3 calls
		for (let i = 0; i < 3; i++) {
			detector.update([toolUse("execute_command", { command: "npm test" })])
		}
		// still looping, interventions exhausted -> stop
		expect(detector.update([toolUse("execute_command", { command: "npm test" })])).toBeUndefined()
		expect(detector.update([toolUse("execute_command", { command: "npm test" })])).toBeUndefined()
		expect(detector.update([toolUse("execute_command", { command: "npm test" })])).toBe("stop")
	})

	it("resets the repeat counter when a different call is made", () => {
		const detector = new LoopDetector(3, 2)
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBe("intervene")
		// different file resets the streak
		expect(detector.update([toolUse("read_file", { path: "/b.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/b.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/b.txt" })])).toBe("intervene")
	})

	it("resets the counter on a text-only turn", () => {
		const detector = new LoopDetector(3, 2)
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		// a text turn breaks the loop signature streak
		expect(detector.update([textMessage("Let me think about this differently.")])).toBeUndefined()
		// a fresh full run is required again
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBe("intervene")
	})

	it("detects loops on MCP tool calls", () => {
		const detector = new LoopDetector(2, 2)
		expect(detector.update([mcpToolUse("search", { query: "orders" })])).toBeUndefined()
		expect(detector.update([mcpToolUse("search", { query: "orders" })])).toBe("intervene")
		// different args do not count as a repeat
		expect(detector.update([mcpToolUse("search", { query: "customers" })])).toBeUndefined()
	})

	it("treats multi-tool turns as one signature", () => {
		const detector = new LoopDetector(2, 2)
		expect(
			detector.update([toolUse("write_to_file", { path: "/x.txt" }), toolUse("read_file", { path: "/x.txt" })]),
		).toBeUndefined()
		expect(
			detector.update([toolUse("write_to_file", { path: "/x.txt" }), toolUse("read_file", { path: "/x.txt" })]),
		).toBe("intervene")
	})

	it("is inert when disabled via maxRepeats of zero", () => {
		const detector = new LoopDetector(0, 2)
		for (let i = 0; i < 10; i++) {
			expect(detector.update([toolUse("read_file", { path: "/a.txt" })])).toBeUndefined()
		}
	})
})
