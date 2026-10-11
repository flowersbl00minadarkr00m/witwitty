import type { Gesture, GestureSample, LandmarkFrame } from '../gesture/engine.js';
import type { Point } from '../core/contracts.js';
/** Recorded classification trace: timestamps are virtual, not wall-clock dependent. */
export function gestureTrace(gesture: Gesture, start: number, point?: Point): GestureSample[] {
  return Array.from({ length: gesture === 'restore' ? 7 : 4 }, (_, i) => ({ at: start + i * 80, gesture, confidence: 0.99, point, deltaY: -25 }));
}
export const CANONICAL_GESTURES: Gesture[] = ['point', 'lock', 'explain', 'depth-left', 'depth-left', 'depth-right', 'depth-right', 'depth-right', 'depth-right', 'zoom-in', 'zoom-in', 'zoom-out', 'zoom-out', 'zoom-out', 'zoom-out', 'rewrite', 'restore'];
export const ADVERSARIAL_GESTURES: GestureSample[] = [
  { at: 1, gesture: 'restore', confidence: 0.4 }, { at: 100, gesture: 'rewrite', confidence: 0.99, ambiguous: true },
  { at: 500, gesture: 'lock', confidence: 0.99 }, { at: 800, gesture: 'lock', confidence: 0.99 },
  { at: 900, gesture: 'none', confidence: 0 },
];
/** Synthetic 21-landmark fixtures test geometry; not a claim of human calibration. */
export function syntheticFrame(pose: 'point' | 'palm' | 'fist' | 'pinch', at: number, x = 0.5, y = 0.8): LandmarkFrame {
  const landmarks = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
  landmarks[0] = { x, y, z: 0 };
  landmarks[4] = { x: x - 0.16, y: y - 0.1, z: 0 };
  for (let finger = 0; finger < 4; finger++) {
    const base = 5 + finger * 4;
    const fx = x + (finger - 1.5) * 0.035;
    landmarks[base] = { x: fx, y: y - 0.1, z: 0 };
    landmarks[base + 1] = { x: fx, y: y - 0.16, z: 0 };
    landmarks[base + 2] = { x: fx, y: y - 0.18, z: 0 };
    const extended = pose === 'palm' || ((pose === 'point' || pose === 'pinch') && finger === 0);
    landmarks[base + 3] = { x: fx, y: y - (extended ? 0.3 : 0.10), z: 0 };
  }
  if (pose === 'pinch')
    landmarks[4] = { ...landmarks[8]!, x: landmarks[8]!.x + 0.02 };
  return { at, landmarks, handedness: 'Right', tracking: 1, hands: 1 };
}
