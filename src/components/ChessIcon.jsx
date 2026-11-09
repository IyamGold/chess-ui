export default function ChessIcon({ name, size = 20, className = '' }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7V5Z" />,
    games: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    user: (
      <>
        <path d="M10.1 2.8a3.1 3.1 0 0 1 3.8 0l1.5 1.1 1.9.3a3.1 3.1 0 0 1 2.7 2.7l.3 1.8 1.1 1.5a3.1 3.1 0 0 1 0 3.8l-1.1 1.5-.3 1.8a3.1 3.1 0 0 1-2.7 2.7l-1.9.3-1.5 1.1a3.1 3.1 0 0 1-3.8 0l-1.5-1.1-1.8-.3a3.1 3.1 0 0 1-2.7-2.7l-.3-1.8-1.1-1.5a3.1 3.1 0 0 1 0-3.8l1.1-1.5.3-1.8a3.1 3.1 0 0 1 2.7-2.7l1.8-.3Z" />
        <circle cx="12" cy="9" r="3" />
        <path d="M7.5 17a4.5 4.5 0 0 1 9 0" />
      </>
    ),
    verified: (
      <>
        <circle cx="10" cy="6.5" r="3.5" />
        <path d="M12 13H8a5 5 0 0 0-5 5v1a2 2 0 0 0 2 2h5m3-3 3 3 6-8" />
      </>
    ),
    friends: (
      <>
        <circle cx="9" cy="6" r="3.5" />
        <path d="M2.5 22v-3a6.5 6.5 0 0 1 13 0v3M19 4v8m-4-4h8" />
      </>
    ),
    computer: (
      <>
        <rect x="3" y="10" width="18" height="11" rx="2" />
        <path d="M12 10V3m-2 0h4" />
      </>
    ),
    join: (
      <>
        <path d="M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5M3 12h12m-5-5 5 5-5 5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    edit: (
      <>
        <path d="m14 5 5 5M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <path d="M3 8V5l14-3v3m4 7h-6v5h6" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 8 3v6c0 6-8 11-8 11S4 17 4 11V5l8-3Z" />
        <path d="m8 11 3 3 5-6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    logout: (
      <>
        <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m6-13 5 5-5 5m-6-5h11" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M3 7h18M3 12h18M3 17h18" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[name] || paths.play}
    </svg>
  );
}
