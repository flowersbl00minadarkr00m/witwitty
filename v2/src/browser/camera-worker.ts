import type { Landmark } from '../gesture/engine.js';
interface Detection {
  landmarks: Landmark[][];
  handedness: Array<Array<{
    categoryName: string;
    score: number;
  }>>;
}
interface Detector {
  detectForVideo(bitmap: ImageBitmap, timestamp: number): Detection;
  close(): void;
}
interface Vision {
  FilesetResolver: {
    forVisionTasks(path: string): Promise<unknown>;
  };
  HandLandmarker: {
    createFromOptions(files: unknown, options: unknown): Promise<Detector>;
  };
}
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
};
let detector: Detector | null = null;
worker.onmessage = async (event) => {
  const data = event.data;
  try {
    if (data?.type === 'init') {
      // Hard-coded same-origin local assets. Never a runtime CDN or remote inference endpoint.
      const moduleURL = new URL('../vendor/vision_bundle.mjs', import.meta.url).href;
      const vision = await import(moduleURL) as Vision;
      const files = await vision.FilesetResolver.forVisionTasks(new URL('../vendor/wasm', import.meta.url).href);
      detector = await vision.HandLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: new URL('../vendor/hand_landmarker.task', import.meta.url).href, delegate: 'CPU' },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.75, minHandPresenceConfidence: 0.75, minTrackingConfidence: 0.75 });
      worker.postMessage({ type: 'ready' });
    }
    else if (data?.type === 'frame' && data.bitmap instanceof ImageBitmap) {
      try {
        if (!detector)
          throw new Error('Detector not ready');
        const result = detector.detectForVideo(data.bitmap, data.at);
        const category = result.handedness[0]?.[0]?.categoryName;
        // The API's category score describes handedness. Do not mislabel it as gesture certainty.
        worker.postMessage({ type: 'landmarks', frame: { at: data.at, landmarks: result.landmarks[0] ?? [],
            handedness: category === 'Left' ? 'Left' : 'Right', tracking: result.landmarks.length === 1 ? 1 : 0, hands: result.landmarks.length } });
      }
      finally {
        data.bitmap.close();
      }
    }
    else if (data?.type === 'stop') {
      detector?.close();
      detector = null;
    }
  }
  catch {
    worker.postMessage({ type: 'error', message: 'Local hand detection unavailable. Check the vendored assets and browser camera support.' });
  }
};
