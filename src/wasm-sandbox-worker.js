'use strict';

const { parentPort, workerData } = require('worker_threads');

(async () => {
  const started = Date.now();
  try {
    const bytes = Buffer.from(workerData.bytes);
    const module = await WebAssembly.compile(bytes);
    const imports = WebAssembly.Module.imports(module);
    if (imports.length) throw new Error('WASM automation imports are forbidden');
    const instance = await WebAssembly.instantiate(module, {});
    const entry = instance.exports.run;
    if (typeof entry !== 'function') throw new Error('WASM automation must export run');
    const output = entry(...workerData.args);
    parentPort.postMessage({
      success: true,
      output: typeof output === 'bigint' ? output.toString() : output,
      durationMs: Date.now() - started,
      imports: [],
      filesystem: false,
      network: false,
      secrets: false
    });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
})();
