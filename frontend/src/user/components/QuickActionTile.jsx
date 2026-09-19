import { useTheme } from '../../theme'

export default function QuickActionTile({ icon: Icon, label, subtitle, onClick }) {
  const { tokens } = useTheme()

  return (
    <button
      type="button"
      className="ft-quick-tile"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '18px 12px',
        borderRadius: tokens.radius.md,
        border: `1px solid ${tokens.border}`,
        background: tokens.surface,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'center',
        color: tokens.text,
      }}
    >
      <div style={{
        width: 40,
        height: 40,
        borderRadius: tokens.radius.sm,
        background: tokens.primarySoft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      >
        <Icon size={20} color={tokens.primary} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, color: tokens.text }}>{label}</span>
      {subtitle && (
        <span style={{ fontSize: 11, color: tokens.textMuted, lineHeight: 1.3 }}>{subtitle}</span>
      )}
    </button>
  )
}
