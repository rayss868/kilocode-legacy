import { describe, expect, it } from "vitest"
import { toolNames } from "@roo-code/types"
import type { NativeToolArgs } from "../../../../shared/tools"
import { TOOL_DISPLAY_NAMES, TOOL_GROUPS } from "../../../../shared/tools"
import { getToolDescriptionsForMode } from "../index"
import { getNativeTools } from "../native-tools"

vi.mock("../../../../services/code-index/managed/ManagedIndexer", () => ({
	ManagedIndexer: {
		getInstance: () => ({
			isEnabled: () => false,
		}),
	},
}))

const nativeLoadSkillArgs: NativeToolArgs["load_skill"] = {
	query: "writer human",
}

void nativeLoadSkillArgs

describe("load_skill tool registry", () => {
	it("registers the canonical tool name and read-group metadata", () => {
		expect(toolNames).toContain("load_skill")
		expect(TOOL_GROUPS.read.tools).toContain("load_skill")
		expect(TOOL_DISPLAY_NAMES.load_skill).toBe("load skills")
	})

	it("registers the native query schema", () => {
		const loadSkillTool = getNativeTools().find(
			(tool): tool is Extract<typeof tool, { type: "function" }> =>
				tool.type === "function" && tool.function.name === "load_skill",
		)

		expect(loadSkillTool?.function.parameters).toMatchObject({
			type: "object",
			properties: {
				query: {
					type: "string",
				},
			},
			required: ["query"],
			additionalProperties: false,
		})
	})

	it("describes flexible skill lookup for the model", () => {
		const descriptions = getToolDescriptionsForMode("code", "/test", false)

		expect(descriptions).toContain("## load_skill")
		expect(descriptions).toContain("query")
		expect(descriptions).toContain("partial")
		expect(descriptions).toContain("separator")
		expect(descriptions).toContain("word order")
		expect(descriptions).toContain("clarification")
	})
})
