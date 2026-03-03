const { Worker } = require('worker_threads');
const path = require('path');

class StockfishPlayer {
  constructor() {
    this.worker = null;
    this.ready = false;
  }

  async init() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(path.join(__dirname, 'stockfishWorker.js'));
      } catch (err) {
        reject(new Error('Failed to start Stockfish worker: ' + err.message));
        return;
      }

      this.worker.on('error', (err) => {
        console.error('Stockfish worker error:', err.message);
        this.ready = false;
        reject(err);
      });

      let initBuffer = '';
      const onMessage = (data) => {
        initBuffer += data;
        if (initBuffer.includes('readyok')) {
          this.worker.removeListener('message', onMessage);
          this.ready = true;
          resolve();
        }
      };

      this.worker.on('message', onMessage);

      // Initialize UCI protocol
      this.worker.postMessage('uci');
      this.worker.postMessage('isready');

      // Timeout after 10 seconds (WASM init can be slower than native)
      setTimeout(() => {
        if (!this.ready) {
          this.worker.removeListener('message', onMessage);
          reject(new Error('Stockfish initialization timed out'));
        }
      }, 10000);
    });
  }

  async getBestMove(fen, skillLevel = 10) {
    if (!this.ready || !this.worker) {
      throw new Error('Stockfish not initialized');
    }

    return new Promise((resolve, reject) => {
      // Set skill level
      this.worker.postMessage(`setoption name Skill Level value ${Math.max(0, Math.min(20, skillLevel))}`);

      let buffer = '';
      const onMessage = (data) => {
        buffer += data;

        if (buffer.includes('bestmove')) {
          this.worker.removeListener('message', onMessage);

          const match = buffer.match(/bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/);
          if (match) {
            resolve({
              from: match[1],
              to: match[2],
              promotion: match[3] || null
            });
          } else {
            // bestmove (none) or parse failure
            resolve(null);
          }
        }
      };

      this.worker.on('message', onMessage);

      // Send position and think
      this.worker.postMessage('ucinewgame');
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage('go movetime 1000');

      // Timeout after 10 seconds
      setTimeout(() => {
        this.worker.removeListener('message', onMessage);
        reject(new Error('Stockfish move timed out'));
      }, 10000);
    });
  }

  terminate() {
    if (this.worker) {
      this.worker.postMessage('quit');
      this.worker.terminate();
      this.worker = null;
      this.ready = false;
    }
  }
}

// Try to create a Stockfish player, return null if unavailable
async function createStockfishPlayer() {
  const player = new StockfishPlayer();
  try {
    await player.init();
    console.log('Stockfish engine initialized successfully');
    return player;
  } catch (err) {
    console.warn('Stockfish not available:', err.message);
    console.warn('Agent vs Engine mode will be disabled');
    return null;
  }
}

module.exports = { StockfishPlayer, createStockfishPlayer };
