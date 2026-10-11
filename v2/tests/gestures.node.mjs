import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureGate, RuleRecognizer, features, validFrame, GESTURES, validateCalibration, calibrationQuality, LearnedClassifier, LandmarkWindow, CAPTURE_WINDOW_MS } from '../dist/gesture/engine.js';
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
test('gesture diagnostics distinguish brief recognition, action, dropout and held latch', () => {
  const gate = new GestureGate();
  assert.deepEqual(gate.accept({ at: 1000, gesture: 'lock', confidence: .99 }), []);
  assert.equal(gate.decision, 'dwell');
  assert.deepEqual(gate.accept({ at: 1080, gesture: 'none', confidence: .2 }), []);
  assert.equal(gate.decision, 'uncertain');
  assert.deepEqual(gate.accept({ at: 1160, gesture: 'lock', confidence: .99 }), []);
  assert.equal(gate.decision, 'dwell');
  assert.equal(gate.accept({ at: 1320, gesture: 'lock', confidence: .99 })[0].type, 'LOCK_TARGET');
  assert.equal(gate.decision, 'action');
  assert.deepEqual(gate.accept({ at: 1400, gesture: 'lock', confidence: .99 }), []);
  assert.equal(gate.decision, 'cooldown');
  for (const at of [1600, 1800, 2000])
    assert.deepEqual(gate.accept({ at, gesture: 'lock', confidence: .99 }), []);
  assert.equal(gate.decision, 'latched');
  assert.deepEqual(gate.accept({ at: 2080, gesture: 'restore', confidence: .9 }), []);
  assert.equal(gate.decision, 'uncertain');
  assert.deepEqual(gate.accept({ at: 2160, gesture: 'point', confidence: .99, ambiguous: true }), []);
  assert.equal(gate.decision, 'ambiguous');
  gate.reset();
  assert.equal(gate.decision, 'idle');
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
test('calibration variation remains recognizable and reaches the shared gesture gate', () => {
  const calibration = profile();
  for (const gesture of GESTURES) {
    const center = calibration.samples[gesture][0];
    calibration.samples[gesture] = [-.06, 0, .06].map(offset => center.map(value => value + offset));
  }
  assert.equal(calibrationQuality(calibration).ready, true);
  const classifier = new LearnedClassifier(calibration);
  for (const gesture of GESTURES) {
    for (const row of calibration.samples[gesture]) {
      const gate = new GestureGate();
      const predictions = gestureTrace(gesture, 1000).map(sample => ({
        ...classifier.predictFeatures(row, sample.at), point: { x: 100, y: 200 }, deltaY: -25,
      }));
      assert.ok(predictions.every(sample => sample.gesture === gesture), `${gesture} must recognize its recorded variation`);
      assert.equal(predictions.flatMap(sample => gate.accept(sample)).at(-1)?.type, expected[gesture]);
    }
  }
});
test('variation tolerance still rejects unfamiliar and competing-class poses', () => {
  const calibration = profile();
  const center = calibration.samples.point[0];
  calibration.samples.point = [-.06, 0, .06].map(offset => center.map(value => value + offset));
  const classifier = new LearnedClassifier(calibration);
  assert.equal(classifier.predictFeatures(center.map(value => value + .3), 1000).gesture, 'none');
  const midpoint = center.map((value, i) => (value + calibration.samples.lock[0][i]) / 2);
  const ambiguous = classifier.predictFeatures(midpoint, 2000);
  assert.equal(ambiguous.gesture, 'none');
  assert.equal(ambiguous.ambiguous, true);
  const originalPrediction = classifier.predictFeatures(calibration.samples.point[0], 3000);
  calibration.samples.point[0].fill(4);
  assert.deepEqual(classifier.predictFeatures(center.map(value => value - .06), 3000), originalPrediction);
});
test('calibration storage rejects corrupt and oversized numeric profiles', () => {
  const valid = profile();
  assert.equal(validateCalibration(valid).version, 1);
  assert.throws(() => validateCalibration({ ...valid, samples: { point: [[NaN]] } }));
  assert.throws(() => validateCalibration({ ...valid, samples: { magic: [[1, 1, 1, 1, 1, 1, 1, 1]] } }));
});

test('close but distinct classes pass readiness and their actual action thresholds', () => {
  const calibration = profile();
  calibration.samples.restore = calibration.samples.lock.map(row => row.map(value => value + .15));
  const before = JSON.stringify(calibration);
  assert.equal(calibrationQuality(calibration).ready, true);
  const classifier = new LearnedClassifier(calibration);
  for (const gesture of ['lock', 'restore']) {
    const gate = new GestureGate();
    const intents = gestureTrace(gesture, 1000).flatMap(sample => gate.accept(classifier.predictFeatures(calibration.samples[gesture][0], sample.at)));
    assert.equal(intents.at(-1)?.type, expected[gesture]);
  }
  assert.equal(JSON.stringify(calibration), before);
});

test('opposite motions remain separate examples without accepting the unrecorded average', () => {
  const calibration = profile();
  calibration.samples.scroll = [-.5, .5, -.45].map(motion => [1.4, 1.4, 1.4, 1.4, 1, 0, motion, 0]);
  const classifier = new LearnedClassifier(calibration);
  for (const row of calibration.samples.scroll) {
    assert.equal(classifier.predictFeatures(row, 1000).gesture, 'scroll');
    assert.equal(classifier.predictFeatures(row.map(v => v + .01), 1000).gesture, 'scroll');
  }
  assert.equal(classifier.predictFeatures([1.4, 1.4, 1.4, 1.4, 1, 0, 0, 0], 1000).gesture, 'none');
});

test('readiness catches a conflicting example even when class averages are far apart', () => {
  const calibration = profile();
  calibration.samples.lock[0] = [...calibration.samples.point[0]];
  const quality = calibrationQuality(calibration);
  assert.equal(quality.ready, false);
  assert.ok(quality.accepted < quality.total);
  assert.throws(() => new LearnedClassifier(calibration), /insufficient separation/);
});

test('recording and live windows extract identical motion and clear stale or wrong-hand history', () => {
  const live = new LandmarkWindow();
  const recording = new LandmarkWindow();
  for (let at = 0; at <= 720; at += 72) {
    const frame = syntheticFrame('point', at, .5, .8 - at / 10000);
    live.push(frame);
    recording.push(frame);
  }
  assert.equal(live.ready, true);
  assert.deepEqual(features(live.frames), features(recording.frames));
  assert.ok(live.frames.at(-1).at - live.frames[0].at >= CAPTURE_WINDOW_MS);
  live.push(syntheticFrame('point', 1100));
  assert.equal(live.ready, false);
  assert.equal(live.frames.length, 1);
  live.push({ ...syntheticFrame('point', 1172), handedness: 'Left' });
  assert.equal(live.frames.length, 1);
  live.push(syntheticFrame('point', 1172));
  assert.equal(live.frames.length, 0);
  recording.push({ ...syntheticFrame('point', 800), hands: 2 });
  assert.equal(recording.ready, false);
});

test('learned prediction abstains on mixed-hand and discontinuous sequences', () => {
  const classifier = new LearnedClassifier(profile());
  const first = syntheticFrame('point', 1000);
  for (const last of [syntheticFrame('point', 900), syntheticFrame('point', 1500), { ...syntheticFrame('point', 1100), handedness: 'Left' }])
    assert.equal(classifier.predict([first, last]).gesture, 'none');
});
test('mouse/keyboard actions use the same domain vocabulary', () => {
  const key = name => ({ key: name, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false });
  const pairs = [['e', { type: 'SET_MODE', mode: 'Explain' }], ['w', { type: 'SET_MODE', mode: 'Rewrite' }], ['r', { type: 'RESTORE' }], [']', { type: 'ZOOM_IN' }], ['[', { type: 'ZOOM_OUT' }], ['Enter', { type: 'LOCK_TARGET' }]];
  for (const [name, intent] of pairs)
    assert.deepEqual(keyboardIntent(key(name), true), intent);
  assert.equal(keyboardIntent(key('e'), false), null);
  assert.equal(keyboardIntent({ ...key('w'), ctrlKey: true }, true), null);
});
