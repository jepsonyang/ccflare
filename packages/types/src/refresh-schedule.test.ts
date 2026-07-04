import { describe, expect, it } from "bun:test";
import {
	parseRefreshSchedule,
	serializeRefreshSchedule,
	shouldFireRefresh,
	validateRefreshSchedule,
} from "./account";

describe("validateRefreshSchedule", () => {
	it("accepts a valid schedule and sorts times ascending", () => {
		const result = validateRefreshSchedule({
			enabled: true,
			times: ["17:30", "05:00"],
		});
		expect(result).toEqual({
			ok: true,
			value: { enabled: true, times: ["05:00", "17:30"] },
		});
	});

	it("coerces a non-true enabled to false", () => {
		const result = validateRefreshSchedule({ times: ["05:00"] });
		expect(result.ok && result.value.enabled).toBe(false);
	});

	it("rejects an invalid time format", () => {
		expect(validateRefreshSchedule({ times: ["5:00"] }).ok).toBe(false);
		expect(validateRefreshSchedule({ times: ["24:00"] }).ok).toBe(false);
		expect(validateRefreshSchedule({ times: ["12:60"] }).ok).toBe(false);
		expect(validateRefreshSchedule({ times: ["ab:cd"] }).ok).toBe(false);
	});

	it("rejects more than five times", () => {
		const result = validateRefreshSchedule({
			times: ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00"],
		});
		expect(result.ok).toBe(false);
	});

	it("accepts exactly five times", () => {
		const result = validateRefreshSchedule({
			times: ["00:00", "01:00", "02:00", "03:00", "04:00"],
		});
		expect(result.ok).toBe(true);
	});

	it("rejects duplicate times", () => {
		const result = validateRefreshSchedule({
			times: ["05:00", "05:00"],
		});
		expect(result).toEqual({ ok: false, error: "Duplicate time" });
	});

	it("rejects non-array times and non-object input", () => {
		expect(validateRefreshSchedule({ times: "05:00" }).ok).toBe(false);
		expect(validateRefreshSchedule(null).ok).toBe(false);
		expect(validateRefreshSchedule("nope").ok).toBe(false);
	});
});

describe("parseRefreshSchedule", () => {
	it("round-trips a serialized schedule", () => {
		const schedule = { enabled: true, times: ["05:00", "17:30"] };
		expect(parseRefreshSchedule(serializeRefreshSchedule(schedule))).toEqual(
			schedule,
		);
	});

	it("returns null for empty, invalid JSON, or invalid content", () => {
		expect(parseRefreshSchedule(null)).toBeNull();
		expect(parseRefreshSchedule("")).toBeNull();
		expect(parseRefreshSchedule("{not json")).toBeNull();
		expect(parseRefreshSchedule('{"times":["25:00"]}')).toBeNull();
	});
});

describe("shouldFireRefresh", () => {
	const schedule = { enabled: true, times: ["05:00", "17:30"] };

	it("fires only when enabled and the time matches", () => {
		expect(shouldFireRefresh(schedule, "05:00")).toBe(true);
		expect(shouldFireRefresh(schedule, "17:30")).toBe(true);
		expect(shouldFireRefresh(schedule, "05:01")).toBe(false);
	});

	it("never fires when disabled or unset", () => {
		expect(shouldFireRefresh({ ...schedule, enabled: false }, "05:00")).toBe(
			false,
		);
		expect(shouldFireRefresh(null, "05:00")).toBe(false);
	});
});
