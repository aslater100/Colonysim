export function MenuItem({ label, hotkey, disabled = false, onClick }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 'var(--gap-sm) var(--gap-md)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      background: 'transparent',
      transition: 'var(--transition-fast)',
      borderLeft: '2px solid transparent',
      fontSize: 'var(--font-size-sm)',
      color: 'var(--color-text-secondary)',
      ':hover': !disabled && { borderLeftColor: 'var(--color-text-accent)' },
    }} onClick={!disabled && onClick}>
      <span>{label}</span>
      {hotkey && <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
        {hotkey}
      </span>}
    </div>
  );
}
