import { Search } from 'lucide-react'
import { cx } from '../utils'

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  style,
  ...props
}) {
  return (
    <div className={cx('ft-search', className)} style={style}>
      <Search size={16} color="var(--ft-text-disabled)" />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        {...props}
      />
    </div>
  )
}

export function FilterBar({ options, value, onChange, className, style }) {
  return (
    <div className={cx('ft-filter-bar', className)} style={style} role="group">
      {options.map((opt, idx) => {
        const active = opt.value === value || opt.key === value
        const key = opt.value ?? opt.key ?? opt.label ?? idx
        return (
          <button
            key={key}
            type="button"
            className={cx('ft-filter-chip', active && 'ft-filter-chip--active')}
            onClick={() => onChange?.(key)}
          >
            {opt.label}
            {opt.count != null && (
              <span className="ft-filter-count">{opt.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
