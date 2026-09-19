import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../utils'

function pageWindow(page, pageCount) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const pages = new Set([1, pageCount, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((n) => pages.add(n))
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((n) => pages.add(n))
  return [...pages].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b)
}

export function Pagination({ page, pageCount, onPageChange, className, style }) {
  if (!pageCount || pageCount < 2) return null
  const items = pageWindow(page, pageCount)

  return (
    <nav className={cx('ft-pagination', className)} style={style} aria-label="Pagination">
      <button
        type="button"
        className="ft-page-btn"
        disabled={page <= 1}
        aria-label="Previous page"
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft size={14} />
      </button>
      {items.map((n, i) => {
        const prev = items[i - 1]
        return (
          <span key={n} style={{ display: 'inline-flex', gap: 4 }}>
            {prev && n - prev > 1 && (
              <span style={{ padding: '0 4px', color: 'var(--ft-text-disabled)' }}>…</span>
            )}
            <button
              type="button"
              className={cx('ft-page-btn', n === page && 'ft-page-btn--active')}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPageChange(n)}
            >
              {n}
            </button>
          </span>
        )
      })}
      <button
        type="button"
        className="ft-page-btn"
        disabled={page >= pageCount}
        aria-label="Next page"
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}
