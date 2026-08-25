import { useEffect, useState } from 'react'
import { ChevronDown, Home } from 'lucide-react'

export interface WorkspaceBreadcrumbMenuItem {
  label: string
  onClick: () => void
}

export interface WorkspaceBreadcrumbItem {
  label: string
  current?: boolean
  expandable?: boolean
  onClick?: () => void
  menuItems?: WorkspaceBreadcrumbMenuItem[]
}

interface WorkspaceBreadcrumbProps {
  ariaLabel: string
  items: WorkspaceBreadcrumbItem[]
  onHome?: () => void
}

export function WorkspaceBreadcrumb({ ariaLabel, items, onHome }: WorkspaceBreadcrumbProps): JSX.Element {
  const [openMenuIndex, setOpenMenuIndex] = useState<number | null>(null)

  useEffect(() => {
    if (openMenuIndex === null) return
    const closeMenu = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.workspace-breadcrumb-menu-anchor')) setOpenMenuIndex(null)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenuIndex(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [openMenuIndex])

  return (
    <nav className="workspace-breadcrumb" aria-label={ariaLabel}>
      {onHome ? (
        <button type="button" className="workspace-breadcrumb-home" onClick={onHome} aria-label={ariaLabel}>
          <Home aria-hidden="true" />
        </button>
      ) : (
        <span className="workspace-breadcrumb-home" aria-hidden="true"><Home /></span>
      )}
      {items.map((item, itemIndex) => (
        <span className="workspace-breadcrumb-segment" key={`${item.label}-${itemIndex}`}>
          <span className="workspace-breadcrumb-separator" aria-hidden="true">/</span>
          {item.menuItems && item.menuItems.length > 0 ? (
            <span className="workspace-breadcrumb-menu-anchor">
              <button
                type="button"
                className={`workspace-breadcrumb-item ${item.current ? 'is-current' : ''}`}
                onClick={() => setOpenMenuIndex((current) => current === itemIndex ? null : itemIndex)}
                aria-current={item.current ? 'page' : undefined}
                aria-haspopup="menu"
                aria-expanded={openMenuIndex === itemIndex}
              >
                {item.label}
                <ChevronDown aria-hidden="true" />
              </button>
              {openMenuIndex === itemIndex && (
                <div className="workspace-breadcrumb-menu" role="menu">
                  {item.menuItems.map((menuItem) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={menuItem.label}
                      onClick={() => {
                        menuItem.onClick()
                        setOpenMenuIndex(null)
                      }}
                    >
                      {menuItem.label}
                    </button>
                  ))}
                </div>
              )}
            </span>
          ) : item.onClick ? (
            <button
              type="button"
              className={`workspace-breadcrumb-item ${item.current ? 'is-current' : ''}`}
              onClick={item.onClick}
              aria-current={item.current ? 'page' : undefined}
            >
              {item.label}
              {item.expandable && <ChevronDown aria-hidden="true" />}
            </button>
          ) : (
            <span className={`workspace-breadcrumb-item ${item.current ? 'is-current' : ''}`} aria-current={item.current ? 'page' : undefined}>
              {item.label}
              {item.expandable && <ChevronDown aria-hidden="true" />}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}
