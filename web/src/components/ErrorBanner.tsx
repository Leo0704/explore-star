interface Props {
  message: string | null;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div
      className="alert alert-danger"
      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
      role="alert"
    >
      <span style={{ flex: 1 }}>⚠ {message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: 0,
          }}
          aria-label="dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}
