import type { LearningAction, RecallOutcome, ReviewStateRecord } from "../types";

const MINUTE = 60_000;
const DAY = 86_400_000;

const after = (now: Date, milliseconds: number) => new Date(now.getTime() + milliseconds).toISOString();

export const initialReviewState = (
  termId: string,
  action: Exclude<LearningAction, "not-jargon">,
  now = new Date(),
): ReviewStateRecord => ({
  termId,
  masteryState: action === "got-it" ? "strengthening" : "learning",
  successfulRecalls: 0,
  nextReviewAt: after(now, action === "got-it" ? 3 * DAY : DAY),
  lastReviewedAt: null,
  updatedAt: now.toISOString(),
});

export const scheduleReviewOutcome = (
  current: ReviewStateRecord,
  outcome: RecallOutcome,
  now = new Date(),
): ReviewStateRecord => {
  if (outcome === "again") {
    return {
      ...current,
      masteryState: "learning",
      successfulRecalls: 0,
      nextReviewAt: after(now, 10 * MINUTE),
      lastReviewedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  if (outcome === "hard") {
    return {
      ...current,
      masteryState: current.successfulRecalls > 0 ? "strengthening" : "learning",
      nextReviewAt: after(now, DAY),
      lastReviewedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  const successfulRecalls = current.successfulRecalls + 1;
  const interval = successfulRecalls === 1 ? 3 * DAY : successfulRecalls === 2 ? 7 * DAY : successfulRecalls < 5 ? 30 * DAY : 90 * DAY;
  return {
    ...current,
    masteryState: successfulRecalls >= 3 ? "known" : successfulRecalls === 2 ? "strengthening" : "learning",
    successfulRecalls,
    nextReviewAt: after(now, interval),
    lastReviewedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
};

export const isReviewDue = (state: ReviewStateRecord, now = new Date()): boolean =>
  Boolean(state.nextReviewAt && state.nextReviewAt <= now.toISOString());
