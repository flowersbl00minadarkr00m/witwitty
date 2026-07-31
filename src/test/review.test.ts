import { describe, expect, it } from "vitest";
import { initialReviewState, isReviewDue, scheduleReviewOutcome } from "../core/review";

describe("deterministic review scheduling", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");

  it("schedules saved and understood terms without treating a click as recall", () => {
    expect(initialReviewState("term-1", "saved", now)).toMatchObject({
      masteryState: "learning",
      successfulRecalls: 0,
      nextReviewAt: "2026-07-21T12:00:00.000Z",
    });
    expect(initialReviewState("term-1", "got-it", now)).toMatchObject({
      masteryState: "strengthening",
      successfulRecalls: 0,
      nextReviewAt: "2026-07-23T12:00:00.000Z",
    });
  });

  it("uses shorter intervals after difficulty and longer intervals after recall", () => {
    const current = initialReviewState("term-1", "saved", new Date("2026-07-19T12:00:00.000Z"));
    expect(scheduleReviewOutcome(current, "again", now)).toMatchObject({
      masteryState: "learning",
      successfulRecalls: 0,
      nextReviewAt: "2026-07-20T12:10:00.000Z",
    });
    expect(scheduleReviewOutcome(current, "hard", now).nextReviewAt).toBe("2026-07-21T12:00:00.000Z");

    const first = scheduleReviewOutcome(current, "recalled", now);
    const second = scheduleReviewOutcome(first, "recalled", new Date(first.nextReviewAt!));
    const third = scheduleReviewOutcome(second, "recalled", new Date(second.nextReviewAt!));
    expect(first).toMatchObject({ successfulRecalls: 1, masteryState: "learning", nextReviewAt: "2026-07-23T12:00:00.000Z" });
    expect(second).toMatchObject({ successfulRecalls: 2, masteryState: "strengthening", nextReviewAt: "2026-07-30T12:00:00.000Z" });
    expect(third).toMatchObject({ successfulRecalls: 3, masteryState: "known", nextReviewAt: "2026-08-29T12:00:00.000Z" });
  });

  it("keeps overdue reviews due after missed alarms", () => {
    const state = initialReviewState("term-1", "saved", new Date("2026-07-01T12:00:00.000Z"));
    expect(isReviewDue(state, now)).toBe(true);
    expect(isReviewDue(state, new Date("2026-07-01T18:00:00.000Z"))).toBe(false);
  });
});
