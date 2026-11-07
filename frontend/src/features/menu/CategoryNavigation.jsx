function CategoryNavigation({ categories, activeCategory, onChange }) {
  return (
    <nav className="category-navigation" aria-label="Menu categories">
      <div className="category-navigation__inner">
        <p className="category-navigation__label">Browse</p>
        <div className="category-navigation__options">
          {categories.map((category) => {
            const isActive = category.slug === activeCategory

            return (
              <button
                className="category-tab"
                data-active={isActive}
                type="button"
                aria-pressed={isActive}
                key={category.slug}
                onClick={() => onChange(category.slug)}
              >
                <span>{category.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}

export default CategoryNavigation
