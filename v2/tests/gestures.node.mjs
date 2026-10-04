import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureGate, RuleRecognizer, features, validFrame, GESTURES, validateCalibration, calibrationQuality, LearnedClassifier } from '../dist/gesture/engine.js';
import { gestureTrace, ADVERSARIAL_GESTURES, syntheticFrame } from '../dist/fixtures/gestures.js';
import { keyboardIntent } from '../dist/browser/inputs.js';
const expected = { point: 'MOVE_FOCUS', lock: 'LOCK_TARGET', explain: 'SET_MODE', rewrite: 'SET_MODE', 'depth-left': 'CHANGE_DEPTH', 'depth-right': 'CHANGE_DEPTH', 'zoom-in': 'ZOOM_IN', 'zoom-out': 'ZOOM_OUT', scroll: 'SCROLL', restore: 'RESTORE' };
for (const gesture of GESTURES)
  test(`gesture ${gesture} emits shared intent after dwell`, () => {
    const gate = new GestureGate();
    const intents = gestureTrace(gesture, 1000, { x: 100, y: 200 }).flatMap(sample => gate.accept(sample));
    assert.ok(intents.length > 0);
    assert.equal(intents.at(-1).type, expected[gesture]);
    if (!['point', 'scroll'].includes(gesture))
      assert.equal(intents.length, 1);
  });
test('uncertain, ambiguous and dropout fixtures never emit semantic action', () => {
  const gate = new GestureGate();
  assert.deepEqual(ADVERSARIAL_GESTURES.flatMap(sample => gate.accept(sample)), []);
});
test('destructive gestures have a stricter confidence threshold', () => {
  for (const gesture of ['restore', 'rewrite']) {
    const gate = new GestureGate();
    assert.deepEqual(gestureTrace(gesture, 1000).flatMap(sample => gate.accept({ ...sample, confidence: .9 })), []);
  }
});
test('cooldown and latch prevent repeated actions from held poses', () => {
  const gate = new GestureGate();
  const samples = Array.from({ length: 30 }, (_, i) => ({ at: 1000 + i * 80, gesture: 'lock', confidence: .99 }));
  assert.equal(samples.flatMap(sample => gate.accept(sample)).length, 1);
});
test('a confidence dropout clears dwell; backwards time is ignored', () => {
  const gate = new GestureGate();
  gate.accept({ at: 1000, gesture: 'lock', confidence: .99 });
  gate.accept({ at: 1080, gesture: 'none', confidence: 0 });
  assert.deepEqual(gate.accept({ at: 1170, gesture: 'lock', confidence: .99 }), []);
  assert.deepEqual(gate.accept({ at: 1000, gesture: 'lock', confidence: .99 }), []);
});
for (const [pose, gesture] of [['point', 'point'], ['pinch', 'lock'], ['fist', 'restore']])
  test(`21 landmark ${pose} geometry`, () => {
    const recognizer = new RuleRecognizer();
    const frame = syntheticFrame(pose, 1000);
    assert.ok(validFrame(frame));
    const sample = recognizer.sample(frame, { width: 1200, height: 800 });
    assert.equal(sample.gesture, gesture);
    assert.ok(sample.confidence >= .9);
  });
test('multiple hands and invalid geometry fail closed', () => {
  const recognizer = new RuleRecognizer();
  const frame = syntheticFrame('point', 1000);
  assert.equal(recognizer.sample({ ...frame, hands: 2 }).gesture, 'none');
  frame.landmarks[5].x = NaN;
  assert.equal(validFrame(frame), false);
  assert.throws(() => features([frame]));
});
test('feature extraction is invariant to translation', () => {
  const a = features([syntheticFrame('point', 1000, .5, .8)]);
  const b = features([syntheticFrame('point', 1000, .6, .9)]);
  a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-9));
});
function profile() { return { version: 1, handedness: 'Right', savedAt: '2026-09-22T00:00:00Z', samples: Object.fromEntries(GESTURES.map((gesture, i) => [gesture, Array.from({ length: 3 }, () => Array.from({ length: 8 }, (_, column) => column === i % 8 ? (i < 8 ? 1 : -1) : 0))])) }; }
test('calibration requires three repetitions and separation for every gesture', () => {
  const valid = profile();
  assert.equal(calibrationQuality(valid).ready, true);
  valid.samples.point = [[0, 0, 0, 0, 0, 0, 0, 0]];
  assert.equal(calibrationQuality(valid).ready, false);
  assert.throws(() => new LearnedClassifier(valid));
});
test('ambiguous calibration classes are rejected', () => {
  const valid = profile();
  valid.samples.lock = structuredClone(valid.samples.point);
  assert.ok(calibrationQuality(valid).issues.some(issue => issue.includes('insufficient separation')));
});
test('learned classifier is frozen and abstains far from calibration', () => {
  const calibration = profile();
  const input = structuredClone(calibration.samples.point[0]);
  const classifier = new LearnedClassifier(calibration);
  calibration.samples.point[0][0] = 4;
  assert.equal(classifier.predictFeatures(input, 1000).gesture, 'point');
  assert.equal(classifier.predictFeatures(Array(8).fill(4), 2000).gesture, 'none');
});
test('calibration storage rejects corrupt and oversized numeric profiles', () => {
  const valid = profile();
  assert.equal(validateCalibration(valid).version, 1);
  assert.throws(() => validateCalibration({ ...valid, samples: { point: [[NaN]] } }));
  assert.throws(() => validateCalibration({ ...valid, samples: { magic: [[1, 1, 1, 1, 1, 1, 1, 1]] } }));
});
test('mouse/keyboard actions use the same domain vocabulary', () => {
  const key = name => ({ key: name, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
  const pairs = [['e', { type: 'SET_MODE', mode: 'Explain' }], ['w', { type: 'SET_MODE', mode: 'Rewrite' }], ['r', { type: 'RESTORE' }], [']', { type: 'ZOOM_IN' }], ['[', { type: 'ZOOM_OUT' }], ['Enter', { type: 'LOCK_TARGET' }]];
  for (const [name, intent] of pairs)
    assert.deepEqual(keyboardIntent(key(name), true), intent);
  assert.equal(keyboardIntent(key('e'), false), null);
  assert.equal(keyboardIntent({ ...key('w'), ctrlKey: true }, true), null);
});
