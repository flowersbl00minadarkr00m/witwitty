import { calibrationQuality, CAPTURE_WINDOW_MS, features, GESTURES, GestureGate, LandmarkWindow, LearnedClassifier, RuleRecognizer, validFrame, validateCalibration, type Calibration, type Gesture, type LandmarkFrame } from '../gesture/engine.js';
import { chromeApi } from '../extension/chrome.js';
import { isRecord } from '../core/contracts.js';
import type { Intent } from '../core/machine.js';
const extension = location.protocol === 'chrome-extension:';
const params = new URLSearchParams(location.search);
let session = params.get('session') ?? '';
let viewport = { width: 1280, height: 800 };
const channel = extension ? null : new BroadcastChannel('witwitty-v2-camera');
const requests = extension ? null : new BroadcastChannel('witwitty-v2-camera-request');
const status = document.querySelector<HTMLElement>('#camera-status')!;
const video = document.querySelector<HTMLVideoElement>('#preview')!;
const gestureSelect = document.querySelector<HTMLSelectElement>('#gesture')!;
const hand = document.querySelector<HTMLSelectElement>('#handedness')!;
const enabled = document.querySelector<HTMLInputElement>('#enable-controls')!;
const controlStatus = document.querySelector<HTMLElement>('#control-status')!;
const lastAction = document.querySelector<HTMLElement>('#last-action')!;
let calibration: Calibration = { version: 1, handedness: 'Right', samples: {}, savedAt: new Date().toISOString() };
let classifier: LearnedClassifier | null = null;
let worker: Worker | null = null;
let stream: MediaStream | null = null;
let frameLoop = 0;
let inFlight = false;
let generation = 0;
let running = false;
let lastCaptured = 0;
const sequence = new LandmarkWindow();
let recording: {
  gesture: Gesture;
  start: number;
  window: LandmarkWindow;
} | null = null;
const rules = new RuleRecognizer();
const gate = new GestureGate();
const instructions: Record<Gesture, string> = {
  point: 'Extend the index finger; fold the other fingers. Hold and point at the passage.',
  lock: 'Bring thumb and index finger together. Hold the pinch briefly.',
  explain: 'Point, then move the hand upward decisively.', rewrite: 'Point, then move the hand downward decisively.',
  'depth-left': 'Pan your hand to your left in the mirrored preview.', 'depth-right': 'Pan your hand to your right in the mirrored preview.',
  'zoom-in': 'Spread a small thumb–index pinch outward.', 'zoom-out': 'Close a wide thumb–index pinch inward.',
  scroll: 'Open all fingers and move the palm vertically.', restore: 'Close all fingers into a fist and hold.',
};
for (const gesture of GESTURES) {
  const option = document.createElement('option');
  option.value = gesture;
  option.textContent = gesture;
  gestureSelect.append(option);
}
gestureSelect.onchange = () => { document.querySelector('#gesture-instruction')!.textContent = instructions[gestureSelect.value as Gesture]; };
document.querySelector('#gesture-instruction')!.textContent = instructions.point;
async function send(type: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!session)
    return;
  if (extension)
    await chromeApi().runtime.sendMessage({ type: `CAMERA_${type.toUpperCase()}`, session, ...extra });
  else
    channel?.postMessage({ kind: type, session, ...extra });
}
function setStatus(text: string, state: 'inactive' | 'starting' | 'active' | 'failed'): void { status.textContent = text; void send('status', { status: state }).catch(() => { }); }
function displayCalibration(): void {
  const quality = calibrationQuality(calibration);
  document.querySelector('#calibration-quality')!.textContent = quality.ready ? `Ready. ${quality.accepted}/${quality.total} saved examples pass recognition. Live accuracy still needs a hand check. Your saved profile is unchanged during use.` : quality.issues.join(' · ');
  document.querySelector('#calibration-counts')!.textContent = GESTURES.map(gesture => `${gesture}: ${(calibration.samples[gesture] ?? []).length}/3`).join('  |  ');
  classifier = quality.ready ? new LearnedClassifier(calibration) : null;
  if (extension && !classifier)
    enabled.checked = false;
}
async function saveCalibration(): Promise<void> {
  calibration.savedAt = new Date().toISOString();
  if (extension) {
    const receipt = await chromeApi().runtime.sendMessage({ type: 'CALIBRATION_SAVE', value: calibration });
    if (!isRecord(receipt) || receipt.ok !== true)
      throw new Error('Calibration could not be saved. Your previous saved profile is still available.');
  }
  else
    localStorage.setItem('witwitty-v2-calibration', JSON.stringify(calibration));
  displayCalibration();
}
async function initialize(): Promise<void> {
  if (extension) {
    const target = await chromeApi().runtime.sendMessage({ type: 'CAMERA_TARGET' });
    if (!isRecord(target) || typeof target.session !== 'string')
      throw new Error('Activate an article and open its Camera control first.');
    session = target.session;
    viewport = { width: Number(target.width), height: Number(target.height) };
    const saved = await chromeApi().runtime.sendMessage({ type: 'CALIBRATION_LOAD' });
    if (saved)
      calibration = validateCalibration(saved);
  }
  else {
    if (requests)
      requests.onmessage = event => { const data = event.data; if (data?.kind === 'session' && data.session === session)
        viewport = { width: data.width, height: data.height }; };
    requests?.postMessage({ kind: 'request', session });
    const saved = localStorage.getItem('witwitty-v2-calibration');
    if (saved)
      calibration = validateCalibration(JSON.parse(saved));
  }
  hand.value = calibration.handedness;
  displayCalibration();
  document.querySelector('#classifier-mode')!.textContent = extension ? 'Extension · personal classifier required for gesture controls' : 'Controlled demo · deterministic rule recognizer';
}
function receiveFrame(frame: LandmarkFrame): void {
  inFlight = false;
  if (!running)
    return;
  if (recording && frame.at - recording.start > 6000) {
    recording = null;
    status.textContent = 'Recording timed out. No samples changed. Keep one hand steadily in view before trying again.';
  }
  if (!validFrame(frame)) {
    sequence.clear();
    recording?.window.clear();
    gate.accept({ at: frame.at, gesture: 'none', confidence: 0 });
    document.querySelector('#recognized')!.textContent = 'No single stable hand';
    controlStatus.textContent = 'Keep one well-lit hand fully in view.';
    return;
  }
  sequence.push(frame);
  if (recording) {
    if (frame.handedness !== calibration.handedness) {
      recording = null;
      status.textContent = 'Wrong hand for this profile. Re-record with the selected hand.';
      return;
    }
    if (frame.at < recording.start) {
      status.textContent = 'Get ready. Recording starts after the one-second countdown.';
      return;
    }
    recording.window.push(frame);
    status.textContent = `Recording ${recording.gesture}. Perform the gesture now.`;
    if (recording.window.ready) {
      const record = recording;
      recording = null;
      const previous = calibration.samples[record.gesture] ?? [];
      calibration.samples[record.gesture] = [...previous, features(record.window.frames)].slice(-12);
      void saveCalibration().then(() => { status.textContent = `Recorded ${record.gesture} from ${record.window.frames.length} stable frames. Only numeric calibration features were saved.`; }).catch(error => {
        calibration.samples[record.gesture] = previous;
        displayCalibration();
        status.textContent = error instanceof Error ? error.message : 'Calibration save failed.';
      });
    }
  }
  let sample = rules.sample(frame, viewport);
  if (extension) {
    sample = sequence.ready ? classifier?.predict(sequence.frames) ?? { at: frame.at, gesture: 'none', confidence: 0 } : { at: frame.at, gesture: 'none', confidence: 0 };
    sample.point = { x: (1 - frame.landmarks[8]!.x) * viewport.width, y: frame.landmarks[8]!.y * viewport.height };
    sample.deltaY = sequence.ready ? Math.max(-100, Math.min(100, -features(sequence.frames)[6]! * 110)) : 0;
  }
  document.querySelector('#recognized')!.textContent = `${sample.gesture} · ${Math.round(sample.confidence * 100)}% score`;
  if (frame.handedness !== calibration.handedness && extension) {
    controlStatus.textContent = `Detector sees ${frame.handedness}; your saved profile is ${calibration.handedness}. Use your calibrated hand. Do not change the Hand setting.`;
    gate.reset();
    return;
  }
  if (enabled.checked && !recording && session) {
    void send('gesture', { gesture: sample.gesture, confidence: sample.confidence, classifier: extension ? 'frozen-calibration' : 'deterministic-rules' }).catch(() => { });
    const intents = gate.accept(sample);
    const feedback = {
      idle: 'Controls ready.', invalid: 'Waiting for a valid tracking sample.',
      uncertain: 'No confident calibrated gesture match. Try the pose you recorded.',
      ambiguous: 'Two gestures are too similar. No action sent.',
      dwell: 'Gesture recognized. Keep it steady a little longer.',
      cooldown: 'Wait briefly before the next action.', latched: 'Action already triggered. Return to a neutral pose before repeating.',
      action: 'Gesture passed the action gate.',
    };
    controlStatus.textContent = feedback[gate.decision];
    for (const intent of intents)
      void sendIntent(intent);
  }
  else {
    gate.reset();
    controlStatus.textContent = recording ? 'Gesture controls are off while recording.' : 'Gesture controls are off. Enable them after calibration is ready.';
  }
}
async function sendIntent(intent: Intent): Promise<void> {
  const run = generation;
  let targetLocked: unknown;
  try {
    if (!session)
      throw new Error('Missing article session');
    if (extension) {
      const receipt = await chromeApi().runtime.sendMessage({ type: 'CAMERA_INTENT', session, intent });
      if (!isRecord(receipt) || receipt.ok !== true)
        throw new Error('Article did not acknowledge the action');
      targetLocked = receipt.targetLocked;
    }
    else
      await send('intent', { intent });
    if (run !== generation || !enabled.checked)
      return;
    if (targetLocked === false && ['LOCK_TARGET', 'SET_MODE', 'CHANGE_DEPTH', 'ZOOM_IN', 'ZOOM_OUT'].includes(intent.type)) {
      lastAction.textContent = 'No passage is locked. Point at a passage, then pinch to lock it. You can also click a paragraph with the mouse first.';
      return;
    }
    const names: Record<string, string> = { MOVE_FOCUS: 'pointing', SCROLL: 'scrolling', LOCK_TARGET: 'target lock', SET_MODE: intent.type === 'SET_MODE' ? intent.mode : 'mode change', CHANGE_DEPTH: 'depth change', ZOOM_IN: 'zoom in', ZOOM_OUT: 'zoom out', RESTORE: 'restore' };
    lastAction.textContent = `${extension ? 'Article received' : 'Sent to demo'}: ${names[intent.type] ?? 'gesture action'}.`;
  }
  catch {
    if (run !== generation || !enabled.checked)
      return;
    enabled.checked = false;
    gate.reset();
    lastAction.textContent = 'Article connection lost. Close this camera window. Activate the article, then open Camera from its controls again.';
  }
}
function stop(): void {
  generation++;
  running = false;
  recording = null;
  cancelAnimationFrame(frameLoop);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  worker?.postMessage({ type: 'stop' });
  worker?.terminate();
  worker = null;
  inFlight = false;
  rules.clear();
  gate.reset();
  sequence.clear();
  enabled.checked = false;
  controlStatus.textContent = 'Gesture controls are off.';
  lastAction.textContent = '';
  setStatus('Camera inactive. No frames retained.', 'inactive');
  document.querySelector<HTMLButtonElement>('#start-camera')!.disabled = false;
}
async function start(): Promise<void> {
  stop();
  const run = generation;
  setStatus('Preparing local detector…', 'starting');
  document.querySelector<HTMLButtonElement>('#start-camera')!.disabled = true;
  try {
    const assets = await fetch(new URL('../vendor/asset-manifest.json', import.meta.url), { cache: 'no-store' });
    if (run !== generation)
      return;
    if (!assets.ok)
      throw new Error('Local camera assets are missing. Run node v2/scripts/vendor-camera.mjs, then rebuild.');
    const detectorWorker = new Worker(new URL('../camera-worker-bootstrap.js', import.meta.url));
    worker = detectorWorker;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local detector initialization timed out.')), 15000);
      detectorWorker.onerror = () => { clearTimeout(timeout); reject(new Error('Local detector worker failed.')); };
      detectorWorker.onmessage = event => {
        if (event.data?.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
        else if (event.data?.type === 'error') {
          clearTimeout(timeout);
          reject(new Error(event.data.message));
        }
      };
      detectorWorker.postMessage({ type: 'init' });
    });
    if (run !== generation)
      return;
    const requestedStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
    if (run !== generation) {
      requestedStream.getTracks().forEach(track => track.stop());
      return;
    }
    stream = requestedStream;
    video.srcObject = stream;
    await video.play();
    if (run !== generation)
      return;
    running = true;
    worker!.onmessage = event => { if (event.data?.type === 'landmarks')
      receiveFrame(event.data.frame);
    else if (event.data?.type === 'error') {
      stop();
      setStatus(event.data.message, 'failed');
    } };
    const capture = async (at: number) => {
      if (!running || run !== generation)
        return;
      frameLoop = requestAnimationFrame(next => { void capture(next); });
      if (inFlight || video.readyState < 2 || at - lastCaptured < 66)
        return;
      inFlight = true;
      lastCaptured = at;
      try {
        const bitmap = await createImageBitmap(video);
        if (run !== generation || !worker) {
          bitmap.close();
          return;
        }
        worker.postMessage({ type: 'frame', bitmap, at }, [bitmap]);
      }
      catch {
        if (run !== generation)
          return;
        stop();
        setStatus('Camera frame capture failed.', 'failed');
      }
    };
    frameLoop = requestAnimationFrame(at => { void capture(at); });
    setStatus('Camera active. Frames stay inside this page and its local worker.', 'active');
  }
  catch (error) {
    if (run !== generation)
      return;
    stop();
    setStatus(error instanceof Error ? error.message : 'Camera permission or initialization failed.', 'failed');
  }
}
document.querySelector<HTMLButtonElement>('#start-camera')!.onclick = () => { void start(); };
document.querySelector<HTMLButtonElement>('#stop-camera')!.onclick = stop;
document.querySelector<HTMLButtonElement>('#record')!.onclick = () => {
  if (!running) {
    status.textContent = 'Start the camera before recording a calibration repetition.';
    return;
  }
  enabled.checked = false;
  gate.reset();
  recording = { gesture: gestureSelect.value as Gesture, start: performance.now() + 1000, window: new LandmarkWindow() };
  status.textContent = `Get ready for ${recording.gesture}. Recording starts in one second and captures ${CAPTURE_WINDOW_MS} ms of stable tracking.`;
};
function reportSaveFailure(error: unknown): void {
  enabled.checked = false;
  status.textContent = error instanceof Error ? error.message : 'Calibration save failed.';
}
document.querySelector<HTMLButtonElement>('#clear-gesture')!.onclick = () => { enabled.checked = false; recording = null; delete calibration.samples[gestureSelect.value as Gesture]; void saveCalibration().catch(reportSaveFailure); };
document.querySelector<HTMLButtonElement>('#reset-calibration')!.onclick = () => { enabled.checked = false; recording = null; calibration = { version: 1, handedness: hand.value as 'Left' | 'Right', samples: {}, savedAt: new Date().toISOString() }; void saveCalibration().catch(reportSaveFailure); };
document.querySelector<HTMLButtonElement>('#export-calibration')!.onclick = () => {
  void (async () => {
    const saved = extension ? await chromeApi().runtime.sendMessage({ type: 'CALIBRATION_LOAD' }) : JSON.parse(localStorage.getItem('witwitty-v2-calibration') ?? 'null');
    if (!saved)
      throw new Error('No saved calibration is available to download.');
    const profile = validateCalibration(saved);
    const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `witwitty-calibration-${profile.handedness.toLowerCase()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Downloaded saved calibration: numeric gesture features only. Your profile is unchanged.';
  })().catch(error => { status.textContent = error instanceof Error ? error.message : 'Calibration download failed.'; });
};
hand.onchange = () => {
  enabled.checked = false;
  recording = null;
  sequence.clear();
  if (Object.values(calibration.samples).some(rows => rows.length)) {
    hand.value = calibration.handedness;
    status.textContent = `Your ${calibration.handedness} profile was kept. Download it before using Reset full calibration to change hands.`;
    return;
  }
  calibration.handedness = hand.value as 'Left' | 'Right';
};
enabled.onchange = () => { if (!running || !session || (extension && !classifier)) {
  enabled.checked = false;
  status.textContent = 'Start the camera, connect an active article, and complete calibration for extension control.';
} gate.reset(); };
window.addEventListener('pagehide', () => { stop(); channel?.close(); requests?.close(); });
document.addEventListener('visibilitychange', () => { if (document.hidden)
  stop(); });
void initialize().catch(error => { setStatus(error instanceof Error ? error.message : 'Camera setup unavailable.', 'failed'); });
