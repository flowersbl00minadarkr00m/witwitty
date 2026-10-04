// MediaPipe 0.10.21 loads its local WASM glue with importScripts().
// Keep a classic worker global while importing our typed worker as a module.
// The first message waits for that import, so initialization cannot be lost.
self.onmessage = async (event) => {
  try {
    await import('./browser/camera-worker.js');
    await self.onmessage(event);
  }
  catch {
    self.postMessage({ type: 'error', message: 'Local detector worker could not start. Rebuild the camera assets.' });
  }
};
