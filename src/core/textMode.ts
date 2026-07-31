export const SIMPLIFICATION_CONFIDENCE_THRESHOLD = 0.8;

export const requiresSimplificationConfirmation = (confidence: number): boolean =>
  !Number.isFinite(confidence) || confidence < SIMPLIFICATION_CONFIDENCE_THRESHOLD;
