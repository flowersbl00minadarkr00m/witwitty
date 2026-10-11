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
export const CAPTURE_WINDOW_MS = 650;
/** Keep one frame at the window boundary so recording and live motion use the same interval. */
export class LandmarkWindow {
  frames: LandmarkFrame[] = [];
  clear(): void { this.frames = []; }
  push(frame: LandmarkFrame): void {
    const last = this.frames.at(-1);
    if (!validFrame(frame) || (last && frame.at <= last.at)) {
      this.clear();
      return;
    }
    if (last && (frame.at - last.at > GESTURE_POLICY.dropoutMs || frame.handedness !== last.handedness))
      this.clear();
    this.frames.push(frame);
    while (this.frames.length > 2 && this.frames[1]!.at <= frame.at - CAPTURE_WINDOW_MS)
      this.frames.shift();
    this.frames = this.frames.slice(-64);
  }
  get ready(): boolean {
    return this.frames.length >= 5 && this.frames.at(-1)!.at - this.frames[0]!.at >= CAPTURE_WINDOW_MS;
  }
}
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
  decision: 'idle' | 'invalid' | 'uncertain' | 'ambiguous' | 'dwell' | 'cooldown' | 'latched' | 'action' = 'idle';
  private candidate: Gesture | 'none' = 'none';
  private since = 0;
  private lastAt = -1;
  private cooldownUntil = 0;
  private latched: Gesture | 'none' = 'none';
  reset(): void { this.candidate = 'none'; this.lastAt = -1; this.latched = 'none'; this.cooldownUntil = 0; this.decision = 'idle'; }
  accept(sample: GestureSample): Intent[] {
    this.decision = 'invalid';
    if (!Number.isFinite(sample.at) || sample.at <= this.lastAt)
      return [];
    if (sample.at - this.lastAt > GESTURE_POLICY.dropoutMs) {
      this.candidate = 'none';
      this.latched = 'none';
    }
    this.lastAt = sample.at;
    const threshold = ['restore', 'rewrite'].includes(sample.gesture) ? GESTURE_POLICY.destructiveConfidence : GESTURE_POLICY.confidence;
    if (sample.ambiguous || !Number.isFinite(sample.confidence) || sample.confidence < threshold || sample.confidence > 1 || sample.gesture === 'none') {
      this.decision = sample.ambiguous ? 'ambiguous' : 'uncertain';
      this.candidate = 'none';
      this.latched = 'none';
      return [];
    }
    if (sample.gesture !== this.candidate) {
      this.candidate = sample.gesture;
      this.since = sample.at;
      this.latched = 'none';
    }
    if (sample.at - this.since < (sample.gesture === 'restore' ? GESTURE_POLICY.restoreDwellMs : GESTURE_POLICY.dwellMs)) {
      this.decision = 'dwell';
      return [];
    }
    if (sample.gesture === 'point') {
      if (!sample.point || !Number.isFinite(sample.point.x) || !Number.isFinite(sample.point.y))
        return [];
      this.decision = 'action';
      return [{ type: 'MOVE_FOCUS', point: sample.point }];
    }
    if (sample.gesture === 'scroll') {
      if (!Number.isFinite(sample.deltaY))
        return [];
      this.decision = 'action';
      return [{ type: 'SCROLL', deltaY: Math.max(-100, Math.min(100, sample.deltaY!)) }];
    }
    if (sample.at < this.cooldownUntil) {
      this.decision = 'cooldown';
      return [];
    }
    if (this.latched === sample.gesture) {
      this.decision = 'latched';
      return [];
    }
    this.decision = 'action';
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
type Prototype = { gesture: Gesture; vector: number[]; radius: number };
function prototypes(calibration: Calibration): Prototype[] {
  const rows = GESTURES.flatMap(gesture => (calibration.samples[gesture] ?? []).map(vector => ({ gesture, vector: [...vector] })));
  return rows.map(row => {
    const separation = Math.min(...rows.filter(other => other.gesture !== row.gesture).map(other => norm(row.vector, other.vector)));
    // Each example owns a bounded neighborhood, never the space between distant repetitions.
    return { ...row, radius: Math.min(0.18, separation / 2) };
  });
}
function classify(model: Prototype[], vector: number[], at: number): GestureSample {
  if (vector.length !== 8 || vector.some(n => !Number.isFinite(n)) || !model.length)
    return { at, gesture: 'none', confidence: 0 };
  const candidates = model.map(row => ({ ...row, distance: norm(vector, row.vector) })).sort((a, b) => a.distance - b.distance);
  const best = candidates[0]!;
  const second = candidates.find(row => row.gesture !== best.gesture);
  if (!second || best.radius <= 0)
    return { at, gesture: 'none', confidence: 0, ambiguous: true };
  const margin = (second.distance - best.distance) / Math.max(second.distance, 0.000001);
  const ambiguous = second.distance < 0.06 || margin < 0.5;
  const proximity = Math.max(0, Math.min(1, 2 - 2 * best.distance / best.radius));
  const confidence = ambiguous ? 0 : proximity * Math.min(1, margin / 0.5);
  return { at, gesture: confidence >= GESTURE_POLICY.confidence ? best.gesture : 'none', confidence, ambiguous };
}
export function calibrationQuality(calibration: Calibration): {
  ready: boolean;
  issues: string[];
  accepted: number;
  total: number;
} {
  const issues: string[] = [];
  const model = prototypes(calibration);
  let accepted = 0;
  let total = 0;
  for (const gesture of GESTURES) {
    const samples = calibration.samples[gesture] ?? [];
    if (samples.length < 3) {
      issues.push(`${gesture}: record at least 3 repetitions`);
      continue;
    }
    const center = samples[0]!.map((_, column) => samples.reduce((sum, row) => sum + row[column]!, 0) / samples.length);
    if (samples.some(sample => norm(sample, center) > 0.6))
      issues.push(`${gesture}: inconsistent repetitions`);
    const threshold = ['rewrite', 'restore'].includes(gesture) ? GESTURE_POLICY.destructiveConfidence : GESTURE_POLICY.confidence;
    const passed = samples.filter(row => {
      const prediction = classify(model, row, 0);
      return prediction.gesture === gesture && !prediction.ambiguous && prediction.confidence >= threshold;
    }).length;
    accepted += passed;
    total += samples.length;
    if (passed !== samples.length)
      issues.push(`${gesture}: insufficient separation; ${passed}/${samples.length} saved examples pass recognition`);
  }
  return { ready: issues.length === 0, issues, accepted, total };
}
/** Frozen prototype classifier. Confidence is a distance/margin score, not a calibrated probability. */
export class LearnedClassifier {
  private model: Prototype[];
  readonly handedness: 'Left' | 'Right';
  constructor(value: Calibration) {
    const calibration = validateCalibration(value);
    const quality = calibrationQuality(calibration);
    if (!quality.ready)
      throw new Error(quality.issues.join('; '));
    this.handedness = calibration.handedness;
    this.model = prototypes(calibration);
  }
  predict(sequence: LandmarkFrame[]): GestureSample {
    const frame = sequence.at(-1);
    if (!frame || !sequence.every(item => validFrame(item) && item.handedness === this.handedness) || sequence.some((item, i) => i > 0 && (item.at <= sequence[i - 1]!.at || item.at - sequence[i - 1]!.at > GESTURE_POLICY.dropoutMs)))
      return { at: frame?.at ?? 0, gesture: 'none', confidence: 0 };
    return this.predictFeatures(features(sequence), frame.at);
  }
  predictFeatures(vector: number[], at: number): GestureSample {
    return classify(this.model, vector, at);
  }
}
