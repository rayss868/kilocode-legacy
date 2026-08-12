import { beforeEach, describe, expect, it, vi } from "vitest"

import { StatePostThrottle } from "../statePostThrottle"

describe("StatePostThrottle", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should post the first call immediately", () => {
		const throttle = new StatePostThrottle(30)
		const post = vi.fn()

		throttle.attempt(post)

		expect(post).toHaveBeenCalledTimes(1)
	})

	it("should skip calls inside the throttle window", () => {
		const throttle = new StatePostThrottle(30)
		const post = vi.fn()

		throttle.attempt(post)
		throttle.attempt(post)
		throttle.attempt(post)

		expect(post).toHaveBeenCalledTimes(1)
	})

	it("should deliver a trailing post for calls dropped inside the window", () => {
		const throttle = new StatePostThrottle(30)
		const post = vi.fn()

		throttle.attempt(post) // immediate
		throttle.attempt(post) // dropped in window
		expect(post).toHaveBeenCalledTimes(1)

		vi.advanceTimersByTime(30)
		expect(post).toHaveBeenCalledTimes(2) // trailing edge delivers the newest state
	})

	it("should not double-fire the trailing post for a long burst", () => {
		const throttle = new StatePostThrottle(30)
		const post = vi.fn()

		throttle.attempt(post) // immediate
		throttle.attempt(post) // schedules trailing
		throttle.attempt(post) // within window, trailing already scheduled
		throttle.attempt(post)

		vi.advanceTimersByTime(30)
		expect(post).toHaveBeenCalledTimes(2)
	})

	it("should post immediately again after the window elapses", () => {
		const throttle = new StatePostThrottle(30)
		const post = vi.fn()

		throttle.attempt(post)
		vi.advanceTimersByTime(50)
		throttle.attempt(post)

		expect(post).toHaveBeenCalledTimes(2)
	})

	it("should not fire a pending trailing post after dispose", () => {
		const throttle = new StatePostThrottle(30)
		const post = vi.fn()

		throttle.attempt(post) // immediate
		throttle.attempt(post) // schedules trailing

		throttle.dispose()
		vi.advanceTimersByTime(30)

		expect(post).toHaveBeenCalledTimes(1)
	})
})
