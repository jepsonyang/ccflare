import { describe, expect, it } from "bun:test";
import { shouldFireCompact } from "./compact-scheduler";

// Build a local-time Date at a specific day-of-month and HH:MM.
function localDate(day: number, hh: number, mm: number): Date {
	return new Date(2026, 6, day, hh, mm, 0, 0); // month is 0-based (July)
}

describe("shouldFireCompact", () => {
	it("fires when enabled and the day and time both match", () => {
		expect(shouldFireCompact(localDate(1, 3, 0), true, 1, "03:00")).toBe(true);
	});

	it("never fires when disabled", () => {
		expect(shouldFireCompact(localDate(1, 3, 0), false, 1, "03:00")).toBe(
			false,
		);
	});

	it("does not fire when the day differs", () => {
		expect(shouldFireCompact(localDate(2, 3, 0), true, 1, "03:00")).toBe(false);
	});

	it("does not fire when the time differs", () => {
		expect(shouldFireCompact(localDate(1, 3, 1), true, 1, "03:00")).toBe(false);
		expect(shouldFireCompact(localDate(1, 4, 0), true, 1, "03:00")).toBe(false);
	});

	it("respects a custom day and time", () => {
		expect(shouldFireCompact(localDate(15, 23, 30), true, 15, "23:30")).toBe(
			true,
		);
	});
});
