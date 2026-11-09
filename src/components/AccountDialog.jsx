import { useEffect, useRef } from 'react';
import AccountPanel from '../login/AccountPanel';
import ChessIcon from './ChessIcon';

export default function AccountDialog({ onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      className="account-dialog"
      ref={dialog}
      aria-labelledby="player-account-title"
      onCancel={onClose}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.target === event.currentTarget &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          onClose();
      }}
    >
      <button
        className="dialog-close"
        aria-label="Close account"
        onClick={onClose}
        autoFocus
      >
        <ChessIcon name="close" />
      </button>
      <AccountPanel />
    </dialog>
  );
}
