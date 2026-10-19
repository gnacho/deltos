/* Deltos landing - tipos globales compartidos por los tres scripts. */

/** API de i18n que publica i18n.ts en window.LandingLang. */
interface LandingLangApi {
  lang: () => string
  textFor: (key: string) => string
  altFor: (key: string) => string
  ariaFor: (key: string) => string
  set: (lang: string) => void
}

interface Window {
  LandingLang: LandingLangApi
}
