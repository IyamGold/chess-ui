const { Worker } = require('worker_threads');
const path = require('path');

class StockfishPlayer {
  constructor({
    thinkMs = 150,
    timeoutMs = 10000,
    workerFactory = () =>
      new Worker(path.join(__dirname, 'stockfishWorker.js')),
  } = {}) {
    this.worker = null;
    this.ready = false;
    this.queue = Promise.resolve();
    this.thinkMs = thinkMs;
    this.timeoutMs = timeoutMs;
    this.workerFactory = workerFactory;
    this.closed = false;
    this.cancel = null;
  }

  async init() {
    if (this.closed) throw new Error('Stockfish stopped');
    const worker = this.workerFactory();
    this.worker = worker;
    // Handle idle worker failures as well as failures during a pending search.
    const unavailable = () => {
      if (this.worker === worker) {
        this.ready = false;
        this.worker = null;
      }
    };
    worker.on('error', unavailable);
    worker.on('exit', unavailable);
    await this.waitFor(worker, 'readyok', () => {
      worker.postMessage('uci');
      worker.postMessage('isready');
    });
    this.ready = true;
  }

  // A failed worker is discarded before another queued position can use it.
  // Otherwise a late bestmove from a timed-out search can belong to the wrong game.
  waitFor(worker, marker, send) {
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        clearTimeout(timer);
        worker.removeListener('message', message);
        worker.removeListener('error', failed);
        worker.removeListener('exit', exited);
        this.cancel = null;
        if (error) {
          this.ready = false;
          if (this.worker === worker) this.worker = null;
          // Keep an error listener until termination settles.
          worker.on('error', () => {});
          void worker.terminate();
          reject(error);
        } else resolve(value);
      };
      const message = (value) => {
        const text = String(value);
        if (text.includes(marker)) finish(null, text);
      };
      const failed = (error) => finish(error);
      const exited = () => finish(new Error('Stockfish worker exited'));
      const timer = setTimeout(
        () => finish(new Error('Stockfish response timed out')),
        this.timeoutMs
      );
      worker.on('message', message);
      worker.once('error', failed);
      worker.once('exit', exited);
      this.cancel = () => finish(new Error('Stockfish stopped'));
      try {
        send();
      } catch (error) {
        finish(error);
      }
    });
  }

  getBestMove(fen, skillLevel = 10) {
    const task = this.queue.then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (this.closed) throw new Error('Stockfish stopped');
          if (!this.ready) await this.init();
          const worker = this.worker;
          const text = await this.waitFor(worker, 'bestmove', () => {
            worker.postMessage(
              `setoption name Skill Level value ${Math.max(
                0,
                Math.min(20, skillLevel)
              )}`
            );
            worker.postMessage('ucinewgame');
            worker.postMessage(`position fen ${fen}`);
            worker.postMessage(`go movetime ${this.thinkMs}`);
          });
          const match = text.match(
            /bestmove ([a-h][1-8])([a-h][1-8])([qrbn])?/
          );
          return match
            ? { from: match[1], to: match[2], promotion: match[3] || null }
            : null;
        } catch (error) {
          if (this.closed || attempt === 1) throw error;
          // Retry this game's position once on a fresh worker, within its queue slot.
        }
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }

  terminate() {
    this.closed = true;
    if (this.cancel) this.cancel();
    else if (this.worker) void this.worker.terminate();
    this.worker = null;
    this.ready = false;
  }
}

async function createStockfishPlayer() {
  const player = new StockfishPlayer();
  try {
    await player.init();
    console.log('Stockfish engine initialized successfully');
    return player;
  } catch (err) {
    player.terminate();
    console.warn('Stockfish not available:', err.message);
    return null;
  }
}
module.exports = { StockfishPlayer, createStockfishPlayer };
