import { isRecord, type Point } from '../core/contracts.js';
import type { Intent } from '../core/machine.js';
export const GESTURES = ['point', 'lock', 'explain', 'rewrite', 'depth-left', 'depth-right', 'zoom-in', 'zoom-out', 'scroll', 'restore'] as const;
export type Gesture = typeof GESTURES[number];
export interface Landmark {
  x: number;
  y: number;
  z: number;
}
export interface LandmarkFrame {
  at: number;
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
  tracking: number;
  hands: number;
}
export interface GestureSample {
  at: number;
  gesture: Gesture | 'none';
  confidence: number;
  point?: Point;
  deltaY?: number;
  ambiguous?: boolean;
}
export const GESTURE_POLICY = Object.freeze({ confidence: 0.86, destructiveConfidence: 0.93, dwellMs: 160, restoreDwellMs: 450, cooldownMs: 650, dropoutMs: 250 });
const distance = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function validFrame(frame: LandmarkFrame): boolean {
  return Number.isFinite(frame.at) && frame.at >= 0 && frame.hands === 1 && frame.landmarks.length === 21 &&
    frame.tracking >= 0.75 && frame.tracking <= 1 && ['Left', 'Right'].includes(frame.handedness) &&
    frame.landmarks.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && p.x >= -0.1 && p.x <= 1.1 && p.y >= -0.1 && p.y <= 1.1 && Math.abs(p.z) < 2);
}
/** Translation/scale invariant pose + sequence motion. Handedness is NOT gesture confidence. */
export function features(frames: LandmarkFrame[]): number[] {
  const last = frames.at(-1);
  const first = frames[0];
  if (!last || !first || !validFrame(last) || !frames.every(validFrame))
    throw new Error('Invalid landmark sequence');
  const p = last.landmarks;
  const wrist = p[0]!;
  const scale = Math.max(0.02, distance(wrist, p[9]!));
  const extension = [8, 12, 16, 20].map(tip => Math.min(3, distance(p[tip]!, wrist) / Math.max(0.01, distance(p[tip - 2]!, wrist))));
  const pinch = Math.min(3, distance(p[4]!, p[8]!) / scale);
  const dt = Math.max(0.05, (last.at - first.at) / 1000);
  const clamp = (n: number) => Math.max(-3, Math.min(3, n));
  return [...extension, pinch, clamp((wrist.x - first.landmarks[0]!.x) / dt), clamp((wrist.y - first.landmarks[0]!.y) / dt),
    clamp((distance(p[4]!, p[8]!) - distance(first.landmarks[4]!, first.landmarks[8]!)) / scale / dt)];
}
export class RuleRecognizer {
  private frames: LandmarkFrame[] = [];
  clear(): void { this.frames = []; }
  sample(frame: LandmarkFrame, viewport = { width: 1, height: 1 }): GestureSample {
    if (!validFrame(frame) || (this.frames.at(-1)?.at ?? -1) >= frame.at) {
      this.clear();
      return { at: frame.at, gesture: 'none', confidence: 0 };
    }
    if (this.frames.length && frame.at - this.frames.at(-1)!.at > GESTURE_POLICY.dropoutMs)
      this.clear();
    this.frames.push(frame);
    this.frames = this.frames.filter(previous => frame.at - previous.at <= 350).slice(-24);
    const f = features(this.frames);
    const fingers = f.slice(0, 4).map(n => n > 1.24);
    const open = fingers.every(Boolean);
    const fist = f.slice(0, 4).every(n => n < 1.05);
    const point = fingers[0] && fingers.slice(1).every(n => !n);
    const pointer = { x: (1 - frame.landmarks[8]!.x) * viewport.width, y: frame.landmarks[8]!.y * viewport.height };
    const dx = f[5]!;
    const dy = f[6]!;
    const dp = f[7]!;
    let gesture: Gesture | 'none' = 'none';
    let confidence = 0;
    // Mutually exclusive priority; ambiguous axes never choose a semantic action.
    const diagonal = Math.abs(dx) > 0.30 && Math.abs(dy) > 0.30 && Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.2;
    if (diagonal)
      return { at: frame.at, gesture: 'none', confidence: 0, ambiguous: true };
    if (fist) {
      gesture = 'restore';
      confidence = 0.97;
    }
    else if (f[4]! < 0.38 && Math.abs(dp) < 0.65) {
      gesture = 'lock';
      confidence = 0.96;
    }
    else if (f[4]! < 1.2 && Math.abs(dp) > 0.9) {
      gesture = dp > 0 ? 'zoom-in' : 'zoom-out';
      confidence = 0.94;
    }
    else if (open && Math.abs(dy) > 0.18 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      gesture = 'scroll';
      confidence = 0.93;
    }
    else if ((open || point) && Math.abs(dx) > 0.30 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      gesture = dx < 0 ? 'depth-right' : 'depth-left';
      confidence = 0.93;
    }
    else if (point && Math.abs(dy) > 0.40 && Math.abs(dy) > Math.abs(dx) * 1.5) {
      gesture = dy < 0 ? 'explain' : 'rewrite';
      confidence = 0.95;
    }
    else if (point) {
      gesture = 'point';
      confidence = 0.94;
    }
    return { at: frame.at, gesture, confidence, point: pointer, deltaY: Math.max(-100, Math.min(100, dy * -110)) };
  }
}
/** This gate is shared by rules, learned predictions and recorded classifications. */
export class GestureGate {
  private candidate: Gesture | 'none' = 'none';
  private since = 0;
  private lastAt = -1;
  private cooldownUntil = 0;
  private latched: Gesture | 'none' = 'none';
  reset(): void { this.candidate = 'none'; this.lastAt = -1; this.latched = 'none'; this.cooldownUntil = 0; }
  accept(sample: GestureSample): Intent[] {
    if (!Number.isFinite(sample.at) || sample.at <= this.lastAt)
      return [];
    if (sample.at - this.lastAt > GESTURE_POLICY.dropoutMs) {
      this.candidate = 'none';
      this.latched = 'none';
    }
    this.lastAt = sample.at;
    const threshold = ['restore', 'rewrite'].includes(sample.gesture) ? GESTURE_POLICY.destructiveConfidence : GESTURE_POLICY.confidence;
    if (sample.ambiguous || !Number.isFinite(sample.confidence) || sample.confidence < threshold || sample.confidence > 1 || sample.gesture === 'none') {
      this.candidate = 'none';
      this.latched = 'none';
      return [];
    }
    if (sample.gesture !== this.candidate) {
      this.candidate = sample.gesture;
      this.since = sample.at;
      this.latched = 'none';
    }
    if (sample.at - this.since < (sample.gesture === 'restore' ? GESTURE_POLICY.restoreDwellMs : GESTURE_POLICY.dwellMs))
      return [];
    if (sample.gesture === 'point')
      return sample.point && Number.isFinite(sample.point.x) && Number.isFinite(sample.point.y) ? [{ type: 'MOVE_FOCUS', point: sample.point }] : [];
    if (sample.gesture === 'scroll')
      return Number.isFinite(sample.deltaY) ? [{ type: 'SCROLL', deltaY: Math.max(-100, Math.min(100, sample.deltaY!)) }] : [];
    if (sample.at < this.cooldownUntil || this.latched === sample.gesture)
      return [];
    this.latched = sample.gesture;
    this.cooldownUntil = sample.at + GESTURE_POLICY.cooldownMs;
    switch (sample.gesture) {
      case 'lock': return [{ type: 'LOCK_TARGET' }];
      case 'explain': return [{ type: 'SET_MODE', mode: 'Explain' }];
      case 'rewrite': return [{ type: 'SET_MODE', mode: 'Rewrite' }];
      case 'depth-left': return [{ type: 'CHANGE_DEPTH', delta: -1 }];
      case 'depth-right': return [{ type: 'CHANGE_DEPTH', delta: 1 }];
      case 'zoom-in': return [{ type: 'ZOOM_IN' }];
      case 'zoom-out': return [{ type: 'ZOOM_OUT' }];
      case 'restore': return [{ type: 'RESTORE' }];
    }
  }
}
export interface Calibration {
  version: 1;
  handedness: 'Left' | 'Right';
  samples: Partial<Record<Gesture, number[][]>>;
  savedAt: string;
}
export function validateCalibration(value: unknown): Calibration {
  if (!isRecord(value) || value.version !== 1 || !['Left', 'Right'].includes(String(value.handedness)) || !isRecord(value.samples) || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)))
    throw new Error('Invalid calibration');
  const samples: Calibration['samples'] = {};
  for (const [gesture, repetitions] of Object.entries(value.samples)) {
    if (!GESTURES.includes(gesture as Gesture) || !Array.isArray(repetitions) || repetitions.length > 12 || repetitions.some(row => !Array.isArray(row) || row.length !== 8 || row.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 5)))
      throw new Error('Invalid calibration sample');
    samples[gesture as Gesture] = repetitions as number[][];
  }
  return { version: 1, handedness: value.handedness as 'Left' | 'Right', samples, savedAt: value.savedAt };
}
const norm = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, value, i) => sum + (value - (b[i] ?? 0)) ** 2, 0) / a.length);
export function calibrationQuality(calibration: Calibration): {
  ready: boolean;
  issues: string[];
} {
  const issues: string[] = [];
  const centers: Partial<Record<Gesture, number[]>> = {};
  for (const gesture of GESTURES) {
    const samples = calibration.samples[gesture] ?? [];
    if (samples.length < 3) {
      issues.push(`${gesture}: record at least 3 repetitions`);
      continue;
    }
    const center = samples[0]!.map((_, column) => samples.reduce((sum, row) => sum + row[column]!, 0) / samples.length);
    centers[gesture] = center;
    if (samples.some(sample => norm(sample, center) > 0.6))
      issues.push(`${gesture}: inconsistent repetitions`);
  }
  const entries = Object.entries(centers);
  entries.forEach(([name, center], i) => entries.slice(i + 1).forEach(([other, second]) => {
    if (norm(center, second) < 0.12)
      issues.push(`${name} and ${other}: insufficient separation`);
  }));
  return { ready: issues.length === 0, issues };
}
/** Frozen prototype classifier. Confidence is a distance/margin score, not a calibrated probability. */
export class LearnedClassifier {
  private centers: Array<{
    gesture: Gesture;
    center: number[];
    radius: number;
  }>;
  readonly handedness: 'Left' | 'Right';
  constructor(value: Calibration) {
    const calibration = validateCalibration(value);
    const quality = calibrationQuality(calibration);
    if (!quality.ready)
      throw new Error(quality.issues.join('; '));
    this.handedness = calibration.handedness;
    this.centers = GESTURES.map(gesture => {
      const rows = calibration.samples[gesture]!;
      const center = rows[0]!.map((_, i) => rows.reduce((sum, row) => sum + row[i]!, 0) / rows.length);
      return { gesture, center, radius: Math.max(0.18, ...rows.map(row => norm(row, center) * 2)) };
    });
  }
  predict(sequence: LandmarkFrame[]): GestureSample {
    const frame = sequence.at(-1);
    if (!frame || !validFrame(frame) || frame.handedness !== this.handedness)
      return { at: frame?.at ?? 0, gesture: 'none', confidence: 0 };
    return this.predictFeatures(features(sequence), frame.at);
  }
  predictFeatures(vector: number[], at: number): GestureSample {
    if (vector.length !== 8 || vector.some(n => !Number.isFinite(n)))
      return { at, gesture: 'none', confidence: 0 };
    const candidates = this.centers.map(center => ({ ...center, distance: norm(vector, center.center) })).sort((a, b) => a.distance - b.distance);
    const best = candidates[0]!;
    const second = candidates[1]!;
    const confidence = Math.max(0, Math.min(1, 1 - best.distance / best.radius)) * Math.min(1, (second.distance - best.distance) / 0.2);
    return { at, gesture: confidence >= GESTURE_POLICY.confidence ? best.gesture : 'none', confidence, ambiguous: second.distance - best.distance < 0.12 };
  }
}
