import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/cin7/rateLimiter.js";

function fakeTime() {
	let now = 1_000_000;
	return {
		clock: () => now,
		sleep: async (ms: number) => {
			now += ms;
		},
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe("createRateLimiter", () => {
	it("never lets more than 55 take() through in any 60 s window over 200 calls", async () => {
		const t = fakeTime();
		const limiter = createRateLimiter({
			perMinute: 55,
			clock: t.clock,
			sleep: t.sleep,
		});
		const stamps: number[] = [];
		for (let i = 0; i < 200; i++) {
			await limiter.take();
			stamps.push(t.clock());
			t.advance(100); // the caller's own work between calls
		}
		for (const start of stamps) {
			const inWindow = stamps.filter((s) => s >= start && s < start + 60_000);
			expect(inWindow.length).toBeLessThanOrEqual(55);
		}
		expect(stamps[199]! - stamps[0]!).toBeGreaterThan(2 * 60_000); // it really waited
	});

	it("does not sleep while under the cap", async () => {
		const t = fakeTime();
		let slept = 0;
		const limiter = createRateLimiter({
			perMinute: 5,
			clock: t.clock,
			sleep: async (ms) => {
				slept += ms;
				await t.sleep(ms);
			},
		});
		for (let i = 0; i < 5; i++) await limiter.take();
		expect(slept).toBe(0);
	});

	it("serialises concurrent callers against the same window", async () => {
		const t = fakeTime();
		const limiter = createRateLimiter({ perMinute: 3, clock: t.clock, sleep: t.sleep });
		const stamps: number[] = [];
		await Promise.all(
			Array.from({ length: 9 }, () =>
				limiter.take().then(() => stamps.push(t.clock()))
			)
		);
		for (const start of stamps) {
			expect(
				stamps.filter((s) => s >= start && s < start + 60_000).length
			).toBeLessThanOrEqual(3);
		}
	});
});
