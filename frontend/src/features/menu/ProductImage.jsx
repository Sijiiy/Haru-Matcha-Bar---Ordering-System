import { useState } from 'react'

function ProductArtwork({ category, productName }) {
  return (
    <div className="product-art" data-category={category} aria-hidden="true">
      <span className="product-art__wordmark">haru.</span>
      <span className="product-art__orb product-art__orb--large" />
      <span className="product-art__orb product-art__orb--small" />
      <span className="product-art__line" />
      <p>{productName}</p>
    </div>
  )
}

function ImageWithFallback({ src, productName, category, loading }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <ProductArtwork category={category} productName={productName} />
  }

  return (
    <img
      src={src}
      // The product heading supplies the accessible name; poster text repeats it.
      alt=""
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

function ProductImage({ src, productName, category, loading = 'lazy' }) {
  return (
    <ImageWithFallback
      key={src || 'fallback'}
      src={src}
      productName={productName}
      category={category}
      loading={loading}
    />
  )
}

export default ProductImage
