import { useCallback, useMemo, useState } from 'react'
import EmptyState from '../../components/ui/EmptyState.jsx'
import ErrorState from '../../components/ui/ErrorState.jsx'
import LoadingState from '../../components/ui/LoadingState.jsx'
import CategoryNavigation from './CategoryNavigation.jsx'
import ProductGrid from './ProductGrid.jsx'
import { useMenu } from './useMenu.js'
import ProductDetailsModal from './ProductDetailsModal.jsx'
import CartModal from '../cart/CartModal.jsx'
import { useCart } from '../cart/useCart.js'
import { cartLineKey, MAX_QUANTITY } from '../cart/cartState.js'
import { formatPeso } from '../../utils/currency.js'
import { useOrderSubmission } from '../orders/useOrderSubmission.js'
import OrderReviewModal from '../orders/OrderReviewModal.jsx'

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

function MenuCategory({ category, index, onSelect }) {
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
          <ProductGrid products={group.products} category={category.slug} onSelect={onSelect} />
        </div>
      ))}
    </section>
  )
}

function MenuPage() {
  const [activeCategory, setActiveCategory] = useState('all')
  const { categories, status, retry } = useMenu()
  const cart = useCart()
  const [modal, setModal] = useState({ type: 'restore' })
  const [confirmation, setConfirmation] = useState('')
  const { dispatch } = cart
  const handleOrderConfirmed = useCallback((order, attempt) => {
    dispatch({ type: 'order-confirmed', submittedLines: attempt.lines })
    setConfirmation(`Order ${order.order_reference} recorded. Payment and barista acceptance are pending.`)
    setModal({ type: 'order' })
  }, [dispatch])
  const submission = useOrderSubmission(handleOrderConfirmed)
  const hasSubmission = Boolean(submission.state.attempt || submission.state.recoveryIssue)
  // Surface recovery on initial render without an effect or automatic HTTP.
  const visibleModal = modal?.type === 'restore'
    ? (submission.state.recovered ? { type: 'order' } : null)
    : modal
  const isMockMode = import.meta.env.VITE_MENU_SOURCE === 'mock'

  const handleProductSelect = (product, category) => {
    setConfirmation('')
    setModal({ type: 'product', product, category })
  }

  const handleAdd = (product, variant, quantity) => {
    const existing = cart.lines.find((line) => line.key === cartLineKey(product.slug, variant.id))
    if ((existing?.quantity || 0) + quantity > MAX_QUANTITY) return false

    cart.dispatch({ type: 'add', product, variant, quantity })
    setConfirmation(`Added ${quantity} × ${product.name}${variant.name ? ` · ${variant.name}` : ''} to your order.`)
    setModal(null)
    return true
  }

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
            {isMockMode ? 'Prototype menu · Mock prices' : 'Touchscreen menu'}
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
                <MenuCategory category={category} index={index} onSelect={handleProductSelect} key={category.id} />
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

      <div className="order-entry">
        <p className="cart-confirmation" role="status">{confirmation}</p>
        <button
          className="order-entry__button"
          type="button"
          aria-label={submission.state.phase === 'success' ? 'View order confirmation' : `Review your order, ${cart.itemCount} ${cart.itemCount === 1 ? 'item' : 'items'}`}
          aria-haspopup="dialog"
          onClick={() => {
            setConfirmation('')
            setModal({ type: hasSubmission ? 'order' : 'cart' })
          }}
        >
          <span className="order-entry__count">{cart.itemCount}</span>
          <span>Your order <small>{submission.state.phase === 'submitting' ? 'Sending order…' : submission.state.phase === 'success' ? 'View confirmation' : hasSubmission ? 'Review submission' : 'Review items'}</small></span>
          <strong>{formatPeso(cart.subtotal)}</strong>
          <span aria-hidden="true">↗</span>
        </button>
      </div>

      {visibleModal?.type === 'product' ? (
        <ProductDetailsModal
          product={visibleModal.product}
          category={visibleModal.category}
          lines={cart.lines}
          onAdd={handleAdd}
          onClose={() => setModal(null)}
        />
      ) : null}
      {visibleModal?.type === 'cart' ? (
        <CartModal
          {...cart}
          onClose={() => setModal(null)}
          onReview={() => setModal({ type: 'order' })}
          hasSubmission={hasSubmission}
        />
      ) : null}
      {visibleModal?.type === 'order' ? (
        <OrderReviewModal
          lines={cart.lines}
          submission={submission}
          onBackToCart={() => setModal({ type: 'cart' })}
          onClose={() => setModal(null)}
        />
      ) : null}
    </div>
  )
}

export default MenuPage
