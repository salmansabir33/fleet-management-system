import { useState } from 'react'
import { ArrowLeft, Menu } from 'lucide-react'
import { IconButton, SearchInput } from '../components'

export function ShellTopbar({
  expanded,
  onToggleNav,
  pageTitle,
  greetingTitle,
  greetingSubtitle,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  searchItems = [],
  onSearchSelect,
  onSearchClear,
  onBack,
  backLabel = 'Back',
  actions,
  profileMenu,
  mobileMinimal = false,
  scrollVisible = true,
}) {
  const title = pageTitle ?? greetingTitle
  const [searchFocused, setSearchFocused] = useState(false)
  const normalizedSearch = String(searchValue || '').trim().toLowerCase()
  const matchingItems = normalizedSearch
    ? searchItems
      .filter((item) => (
        `${item.label || ''} ${item.keywords || ''}`.toLowerCase().includes(normalizedSearch)
      ))
      .slice(0, 6)
    : []

  const selectSearchItem = (item) => {
    onSearchSelect?.(item)
    setSearchFocused(false)
  }

  // Mobile portals: no bar/strip — bell + profile float over page content.
  if (mobileMinimal) {
    return (
      <div
        className={`ft-shell-topbar-float${scrollVisible ? '' : ' ft-shell-topbar-float--hidden'}`}
        role="banner"
        aria-hidden={scrollVisible ? undefined : true}
      >
        <div className="ft-shell-topbar-float-actions">
          {actions && (
            <div className="ft-shell-topbar-float-chip">
              {actions}
            </div>
          )}
          {profileMenu && (
            <div className="ft-shell-topbar-float-chip ft-shell-topbar-float-chip--profile">
              {profileMenu}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <header className="ft-shell-topbar ft-glass">
      <div className="ft-shell-topbar-left">
        {!mobileMinimal && (
          <IconButton
            label={expanded ? 'Collapse menu' : 'Expand menu'}
            className="ft-shell-topbar-icon-btn ft-shell-topbar-menu-btn"
            onClick={onToggleNav}
          >
            <Menu size={18} />
          </IconButton>
        )}
        {onBack && (
          <IconButton
            label={backLabel}
            className="ft-shell-topbar-icon-btn"
            onClick={onBack}
          >
            <ArrowLeft size={18} />
          </IconButton>
        )}
        {!mobileMinimal && title && (
          <div className="ft-shell-greeting">
            {pageTitle ? (
              <h1 className="ft-shell-page-title">{pageTitle}</h1>
            ) : (
              <>
                <div className="ft-shell-greeting-title">
                  {greetingTitle}
                  {' '}
                  <span aria-hidden>👋</span>
                </div>
                {greetingSubtitle && (
                  <div className="ft-shell-greeting-sub">{greetingSubtitle}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {!mobileMinimal && (
        <div className="ft-shell-topbar-search">
          <SearchInput
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            aria-label="Search"
            aria-expanded={searchFocused && Boolean(normalizedSearch)}
            aria-controls="ft-portal-search-results"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matchingItems[0]) {
                event.preventDefault()
                selectSearchItem(matchingItems[0])
              } else if (event.key === 'Escape') {
                onSearchClear?.()
                event.currentTarget.blur()
              }
            }}
          />
          {searchFocused && normalizedSearch && onSearchSelect && (
            <div
              id="ft-portal-search-results"
              className="ft-shell-search-results"
              role="listbox"
            >
              {matchingItems.length > 0 ? matchingItems.map((item) => (
                <button
                  key={item.to}
                  type="button"
                  className="ft-shell-search-result"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    selectSearchItem(item)
                  }}
                >
                  {item.icon && <item.icon size={15} aria-hidden />}
                  <span>{item.label}</span>
                </button>
              )) : (
                <div className="ft-shell-search-empty">No matching page</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="ft-shell-topbar-right">
        {actions}
        {profileMenu}
      </div>
    </header>
  )
}

export function ShellTopbarIconWrap({ children, badge }) {
  return (
    <div className="ft-shell-icon-wrap">
      {children}
      {badge > 0 && (
        <span className="ft-shell-count-badge">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </div>
  )
}
