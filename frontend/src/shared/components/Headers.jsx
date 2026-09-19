import { cx } from '../utils'

export function PageHeader({ title, subtitle, center, actions, className, style }) {
  return (
    <header
      className={cx('ft-page-header', center && 'ft-page-header--with-center', className)}
      style={style}
    >
      <div className="ft-page-header__lead">
        <h1 className="ft-page-title">{title}</h1>
        {subtitle && <p className="ft-header-sub">{subtitle}</p>}
      </div>
      {center ? <div className="ft-page-header__center">{center}</div> : null}
      {actions ? (
        <div className="ft-page-header__actions">{actions}</div>
      ) : null}
    </header>
  )
}

export function SectionHeader({ title, subtitle, actions, className, style }) {
  return (
    <div className={cx('ft-section-header', className)} style={style}>
      <div>
        <h2 className="ft-section-title">{title}</h2>
        {subtitle && <p className="ft-header-sub">{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>{actions}</div>}
    </div>
  )
}
