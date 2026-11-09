import './LoadingScreen.css';
export default function LoadingScreen({
  label = 'Getting your game ready',
  fullScreen = false,
}) {
  return (
    <div
      className={`loading-screen${fullScreen ? ' loading-screen--full' : ''}`}
      role="status"
      aria-live="polite"
    >
      <img
        className="loading-knight"
        src="/blackknight.svg"
        width="56"
        height="64"
        alt=""
      />
      <span className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="loading-label">{label}</span>
    </div>
  );
}
