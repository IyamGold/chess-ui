// Adapter: bridges stockfish.js (Emscripten Web Worker build) → Node.js worker_threads
const { parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');

// stockfish.wasm.js expects Web Worker globals: postMessage, onmessage, close
global.postMessage = (msg) => parentPort.postMessage(msg);
global.close = () => process.exit();

parentPort.on('message', (data) => {
  if (global.onmessage) global.onmessage({ data });
});

// The Emscripten build resolves "stockfish.wasm" relative to CWD (its locateFile
// returns just the filename). Since worker_threads don't support process.chdir(),
// intercept readFileSync to resolve the bare filename to its absolute path.
const sfDir = path.dirname(require.resolve('stockfish.js'));
const origReadFileSync = fs.readFileSync;
fs.readFileSync = function (filePath, ...args) {
  if (filePath === 'stockfish.wasm') {
    filePath = path.join(sfDir, 'stockfish.wasm');
  }
  return origReadFileSync.call(this, filePath, ...args);
};

// Node 18+ exposes global fetch, which tricks the Emscripten build into using
// fetch("stockfish.wasm") instead of readFileSync. Remove it so it falls back
// to the sync file-read path.
delete globalThis.fetch;

// Loading the module auto-initializes the engine
require('stockfish.js');
