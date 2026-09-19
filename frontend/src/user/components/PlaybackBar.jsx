import { memo } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { useTheme } from '../../theme'

const SPEED_OPTIONS = [1, 2, 4, 8]

const PlaybackBar = ({
  minIndex,
  maxIndex,
  currentIndex,
  onSeek,
  playing,
  onTogglePlay,
  onStepBack,
  onStepForward,
  speedMultiplier,
  onSetSpeed,
  timestampLabel,
  pointLabel,
  disabled,
}) => {
  const { tokens } = useTheme()

  const iconBtn = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.35)',
    background: 'rgba(255, 255, 255, 0.12)',
    color: tokens.text,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: tokens.motion.transitionFast,
  }

  return (
    <div className="playback-overlay-bar" style={{ borderRadius: 12, padding: '10px 16px 12px' }}>
      <input
        type="range"
        min={minIndex}
        max={maxIndex}
        value={currentIndex}
        onChange={onSeek}
        style={{ width: '100%', height: 6, marginBottom: 8, accentColor: tokens.primary }}
        disabled={disabled}
      />

      <div className="playback-overlay-bar-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button type="button" style={iconBtn} onClick={onStepBack} disabled={disabled} aria-label="Previous point">
            <SkipBack size={15} />
          </button>
          <button
            type="button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 10,
              border: 'none',
              background: tokens.primary,
              color: '#fff',
              cursor: disabled ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 4px rgba(17,24,39,0.25)',
            }}
            onClick={onTogglePlay}
            disabled={disabled}
            aria-label={playing ? 'Pause' : 'Play'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing
              ? <Pause size={18} fill="currentColor" />
              : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
          </button>
          <button type="button" style={iconBtn} onClick={onStepForward} disabled={disabled} aria-label="Next point">
            <SkipForward size={15} />
          </button>
        </div>

        <div className="playback-overlay-bar-meta">
          <span style={{
            fontSize: 12,
            fontWeight: 700,
            color: tokens.text,
            whiteSpace: 'nowrap',
          }}
          >
            {timestampLabel || '—'}
          </span>
          {pointLabel && (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              color: tokens.textMuted,
              whiteSpace: 'nowrap',
            }}
            >
              {pointLabel}
            </span>
          )}
        </div>

        <div className="playback-overlay-bar-speeds">
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSetSpeed(s)}
              style={{
                padding: '5px 8px',
                borderRadius: 6,
                border: 'none',
                background: s === speedMultiplier ? tokens.primary : 'transparent',
                fontSize: 11,
                fontWeight: 700,
                color: s === speedMultiplier ? '#fff' : tokens.textMuted,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              <span className="playback-overlay-speed-label-full">{s}x Speed</span>
              <span className="playback-overlay-speed-label-short">{s}x</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default memo(PlaybackBar)
