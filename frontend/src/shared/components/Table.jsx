import { cx } from '../utils'
import { Skeleton } from './Feedback'

function SkeletonRows({ columns, rows }) {
  const cols = columns?.length
    ? columns
    : [{ key: 'sk', align: 'left' }]

  return Array.from({ length: rows }, (_, rowIdx) => (
    <tr key={`skeleton-${rowIdx}`} aria-hidden>
      {cols.map((col, colIdx) => (
        <td
          key={col.key || colIdx}
          className={col.className}
          style={{ textAlign: col.align || 'left', width: col.width }}
        >
          <Skeleton
            width={col.align === 'right' ? '44%' : rowIdx % 2 === 0 ? '72%' : '58%'}
            height={12}
          />
        </td>
      ))}
    </tr>
  ))
}

export function Table({
  columns,
  children,
  className,
  style,
  loading = false,
  skeletonRows = 5,
  footer,
}) {
  return (
    <div
      className={cx('ft-table-wrap', className)}
      style={style}
      aria-busy={loading || undefined}
    >
      <table className="ft-table">
        {columns ? (
          <>
            <thead>
              <tr>
                {columns.map((col, idx) => (
                  <th
                    key={col.key ?? col.label ?? idx}
                    className={col.className}
                    title={col.title}
                    style={{
                      textAlign: col.align || 'left',
                      width: col.width,
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? <SkeletonRows columns={columns} rows={skeletonRows} />
                : children}
            </tbody>
            {!loading && footer ? <tfoot>{footer}</tfoot> : null}
          </>
        ) : loading ? (
          <tbody>
            <SkeletonRows rows={skeletonRows} />
          </tbody>
        ) : (
          <>
            {children}
            {footer ? <tfoot>{footer}</tfoot> : null}
          </>
        )}
      </table>
    </div>
  )
}

export function TableRow({ children, onClick, clickable, className, style }) {
  const isClickable = clickable ?? typeof onClick === 'function'
  return (
    <tr
      className={cx('ft-table-row', isClickable && 'ft-table-row--clickable', className)}
      onClick={onClick}
      style={style}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.(event)
        }
      } : undefined}
    >
      {children}
    </tr>
  )
}
