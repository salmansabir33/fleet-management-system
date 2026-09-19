import { useTheme } from '../../theme'
import { hexToRgba } from '../../shared/utils'
import { Badge } from '../../shared/components'

/** Pulsing "Live" pill for map card headers. */
export function LiveBadge({ offline = false }) {
  const { tokens } = useTheme()
  const color = offline ? tokens.textMuted : tokens.semantic.success

  return (
    <Badge color={color} background={hexToRgba(color, 0.14)} pill>
      {!offline && (
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            width: 8,
            height: 8,
            flexShrink: 0,
          }}
          aria-hidden
        >
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: color,
            }}
          />
          <span
            className="ft-live-ring"
            style={{
              position: 'absolute',
              inset: -4,
              borderRadius: '50%',
              background: color,
            }}
          />
        </span>
      )}
      {offline ? 'Offline' : 'Live'}
    </Badge>
  )
}

export default LiveBadge
