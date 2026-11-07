import { useMemo, useState } from 'react'
import EmptyState from '../../components/ui/EmptyState.jsx'
import ErrorState from '../../components/ui/ErrorState.jsx'
import LoadingState from '../../components/ui/LoadingState.jsx'
import CategoryNavigation from './CategoryNavigation.jsx'
import ProductGrid from './ProductGrid.jsx'
import { useMenu } from './useMenu.js'

const categoryOptions = [
  { slug: 'all', label: 'All' },
  { slug: 'matcha', label: 'Matcha' },
  { slug: 'hojicha', label: 'Hojicha' },
  { slug: 'coffee', label: 'Coffee' },
]

function groupProducts(category) {
  if (category.slug !== 'matcha') {
    return [{ name: null, products: category.products }]
  }

  const groups = new Map()

  category.products.forEach((product) => {
    const groupName = product.section || 'Matcha'
    const products = groups.get(groupName) || []
    groups.set(groupName, [...products, product])
  })

  return Array.from(groups, ([name, products]) => ({ name, products }))
}

function MenuCategory({ category, index }) {
  const groups = groupProducts(category)
  const categoryHeadingId = `category-${category.slug}`

  return (
    <section className="menu-category" aria-labelledby={categoryHeadingId}>
      <header className="menu-category__header">
        <div>
          <p>{String(index + 1).padStart(2, '0')} / Menu</p>
          <h2 id={categoryHeadingId}>{category.name}</h2>
        </div>
        <span aria-hidden="true">haru.</span>
      </header>

      {groups.map((group) => (
        <div className="menu-group" key={group.name || category.slug}>
          {group.name ? (
            <div className="menu-group__heading">
              <h3>{group.name}</h3>
              <span />
            </div>
          ) : null}
          <ProductGrid products={group.products} category={category.slug} />
        </div>
      ))}
    </section>
  )
}

function MenuPage() {
  const [activeCategory, setActiveCategory] = useState('all')
  const { categories, status, retry } = useMenu()

  const visibleCategories = useMemo(() => {
    if (activeCategory === 'all') {
      return categories
    }

    return categories.filter((category) => category.slug === activeCategory)
  }, [activeCategory, categories])

  const handleCategoryChange = (category) => {
    setActiveCategory(category)
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    document.querySelector('#menu-content')?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  return (
    <div className="kiosk-shell">
      <header className="kiosk-header">
        <div className="brand-lockup" aria-label="Haru Matcha Bar">
          <span className="brand-wordmark">haru.</span>
          <span className="brand-description">matcha bar</span>
        </div>
        <div className="oat-note">
          <span aria-hidden="true" />
          All drinks served with oat milk
        </div>
      </header>

      <main>
        <section className="menu-intro" aria-labelledby="menu-title">
          <div className="menu-intro__eyebrow">
            <span />
            Touchscreen menu
          </div>
          <div className="menu-intro__copy">
            <h1 id="menu-title">Find your next cup.</h1>
            <p>
              Browse matcha, hojicha, and coffee. All drinks are served with oat
              milk.
            </p>
          </div>
          <div className="menu-intro__accent" aria-hidden="true">
            <span>H</span>
            <p>matcha / hojicha / coffee</p>
          </div>
        </section>

        {status === 'success' && categories.length > 0 ? (
          <CategoryNavigation
            categories={categoryOptions}
            activeCategory={activeCategory}
            onChange={handleCategoryChange}
          />
        ) : null}

        <div className="menu-content" id="menu-content">
          {status === 'loading' ? <LoadingState /> : null}
          {status === 'error' ? <ErrorState onRetry={retry} /> : null}
          {status === 'success' && categories.length === 0 ? <EmptyState /> : null}
          {status === 'success' && categories.length > 0 ? (
            visibleCategories.length > 0 ? (
              visibleCategories.map((category, index) => (
                <MenuCategory category={category} index={index} key={category.id} />
              ))
            ) : (
              <EmptyState />
            )
          ) : null}
        </div>
      </main>

      <footer className="kiosk-footer">
        <span className="brand-wordmark">haru.</span>
        <p>All drinks served with oat milk.</p>
      </footer>
    </div>
  )
}

export default MenuPage
