import volumeI from '../../../images/products/matcha/Haru_Matcha_Volume_I.png'
import volumeII from '../../../images/products/matcha/Haru_Matcha_Volume_II.png'
import volumeIII from '../../../images/products/matcha/Haru_Matcha_Volume_III.png'
import rozu from '../../../images/products/matcha/Haru_Rōzu_Matcha_Latte.png'
import kohaku from '../../../images/products/matcha/Haru_Kohaku_Milk_Matcha.png'
import kogaCrunch from '../../../images/products/matcha/Haru_Koga_Crunch_Matcha_Cereal_Milk.png'
import bananaYume from '../../../images/products/matcha/Haru_Banana_Yume_Matcha_Cream.png'
import shioCream from '../../../images/products/matcha/Haru_Shio_Cream_Matcha_Delight.png'
import koganeCream from '../../../images/products/matcha/Haru_Kogane_Cream_Matcha_Crunch.png'
import hojicha from '../../../images/products/hojicha/Haru_Hojicha_Latte.png'
import seaSaltCreamHojicha from '../../../images/products/hojicha/Haru_SeaSalt_Cream_Hojicha.png'
import cerealCrunchHojicha from '../../../images/products/hojicha/Haru_Cereal_Crunch_Hojicha.png'
import espressoHot from '../../../images/products/coffee/Haru_Espresso-HOT.png'
import americanoHot from '../../../images/products/coffee/Haru_Americano-HOT.png'
import americanoIced from '../../../images/products/coffee/Haru_Americano-ICED.png'
import latteHot from '../../../images/products/coffee/Haru_Latte-HOT.png'
import latteIced from '../../../images/products/coffee/Haru_Latte-ICED.png'
import spanishLatteHot from '../../../images/products/coffee/Haru_Spanish_Latte-HOT.png'
import spanishLatteIced from '../../../images/products/coffee/Haru_Spanish_Latte-ICED.png'
import creamMochaLatteHot from '../../../images/products/coffee/Haru_Cream_Mocha_Latte-HOT.png'
import creamMochaLatteIced from '../../../images/products/coffee/Haru_Cream_Mocha_Latte-ICED.png'
import honeyOatLatteHot from '../../../images/products/coffee/Haru_Honey_Oat_Latte-HOT.png'
import honeyOatLatteIced from '../../../images/products/coffee/Haru_Honey_Oat_Latte-ICED.png'

// Asset metadata only. Slugs match the catalog; prices and variants remain in
// the menu data source. Vite resolves these files in place for dev and build.
export const productImages = {
  'volume-i': { default: volumeI },
  'volume-ii': { default: volumeII },
  'volume-iii': { default: volumeIII },
  rozu: { default: rozu },
  kohaku: { default: kohaku },
  'koga-crunch': { default: kogaCrunch },
  'banana-yume': { default: bananaYume },
  'shio-cream': { default: shioCream },
  'kogane-cream': { default: koganeCream },
  hojicha: { default: hojicha },
  'sea-salt-cream-hojicha': { default: seaSaltCreamHojicha },
  'cereal-crunch-hojicha': { default: cerealCrunchHojicha },
  espresso: { default: espressoHot, hot: espressoHot },
  americano: { default: americanoIced, hot: americanoHot, iced: americanoIced },
  latte: { default: latteIced, hot: latteHot, iced: latteIced },
  'spanish-latte': {
    default: spanishLatteIced,
    hot: spanishLatteHot,
    iced: spanishLatteIced,
  },
  'cream-mocha-latte': {
    default: creamMochaLatteIced,
    hot: creamMochaLatteHot,
    iced: creamMochaLatteIced,
  },
  'honey-oat-latte': {
    default: honeyOatLatteIced,
    hot: honeyOatLatteHot,
    iced: honeyOatLatteIced,
  },
}

export function getProductImage(product, variantName) {
  const images = productImages[product.slug]
  const variantKey = variantName?.toLowerCase()
  const variantImage = variantKey === 'hot' || variantKey === 'iced'
    ? images?.[variantKey]
    : null

  return variantImage || product.image_path || images?.default
}
