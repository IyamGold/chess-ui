// Chess sound effects using HTML5 Audio

// Create audio objects for each sound
const moveSound = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/move-self.mp3');
const captureSound = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/capture.mp3');
const notifySound = new Audio('https://images.chesscomfiles.com/chess-themes/sounds/_MP3_/default/notify.mp3');

// Set volume (0.0 to 1.0)
moveSound.volume = 0.5;
captureSound.volume = 0.5;
notifySound.volume = 0.6;

// Play move sound
export const playMoveSound = () => {
  // Clone the audio to allow overlapping sounds
  const sound = moveSound.cloneNode();
  sound.volume = moveSound.volume;
  sound.play().catch(err => console.log('Audio play failed:', err));
};

// Play capture sound
export const playCaptureSound = () => {
  // Clone the audio to allow overlapping sounds
  const sound = captureSound.cloneNode();
  sound.volume = captureSound.volume;
  sound.play().catch(err => console.log('Audio play failed:', err));
};

// Play notify sound (for game end events)
export const playNotifySound = () => {
  // Clone the audio to allow overlapping sounds
  const sound = notifySound.cloneNode();
  sound.volume = notifySound.volume;
  sound.play().catch(err => console.log('Audio play failed:', err));
};

