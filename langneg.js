
const languageCodeRe = "([a-z]{2,3}|\\*)";
const scriptCodeRe = "(?:-([a-z]{4}|\\*))";
const regionCodeRe = "(?:-([a-z]{2}|\\*))";
const variantCodeRe = "(?:-(([0-9][a-z0-9]{3}|[a-z0-9]{5,8})|\\*))";
/**
 * Regular expression splitting locale id into four pieces:
 *
 * Example: `en-Latn-US-macos`
 *
 * language: en
 * script:   Latn
 * region:   US
 * variant:  macos
 *
 * It can also accept a range `*` character on any position.
 */
const localeRe = new RegExp(
  `^${languageCodeRe}${scriptCodeRe}?${regionCodeRe}?${variantCodeRe}?$`,
  "i"
);
class Locale {
  /**
   * Parses a locale id using the localeRe into an array with four elements.
   *
   * If the second argument `range` is set to true, it places range `*` char
   * in place of any missing piece.
   *
   * It also allows skipping the script section of the id, so `en-US` is
   * properly parsed as `en-*-US-*`.
   */
  constructor(locale) {
    const result = localeRe.exec(locale.replace(/_/g, "-"));
    if (!result) {
      this.isWellFormed = false;
      return;
    }
    let [, language, script, region, variant] = result;
    if (language) {
      this.language = language.toLowerCase();
    }
    if (script) {
      this.script = script[0].toUpperCase() + script.slice(1);
    }
    if (region) {
      this.region = region.toUpperCase();
    }
    this.variant = variant;
    this.isWellFormed = true;
  }
  isEqual(other) {
    return (
      this.language === other.language &&
      this.script === other.script &&
      this.region === other.region &&
      this.variant === other.variant
    );
  }
  matches(other, thisRange = false, otherRange = false) {
    return (
      (this.language === other.language ||
        (thisRange && this.language === undefined) ||
        (otherRange && other.language === undefined)) &&
      (this.script === other.script ||
        (thisRange && this.script === undefined) ||
        (otherRange && other.script === undefined)) &&
      (this.region === other.region ||
        (thisRange && this.region === undefined) ||
        (otherRange && other.region === undefined)) &&
      (this.variant === other.variant ||
        (thisRange && this.variant === undefined) ||
        (otherRange && other.variant === undefined))
    );
  }
  toString() {
    return [this.language, this.script, this.region, this.variant]
      .filter((part) => part !== undefined)
      .join("-");
  }
  clearVariants() {
    this.variant = undefined;
  }
  clearRegion() {
    this.region = undefined;
  }
  addLikelySubtags() {
    const newLocale = getLikelySubtagsMin(this.toString().toLowerCase());
    if (newLocale) {
      this.language = newLocale.language;
      this.script = newLocale.script;
      this.region = newLocale.region;
      this.variant = newLocale.variant;
      return true;
    }
    return false;
  }
}
/**
 * Below is a manually a list of likely subtags corresponding to Unicode
 * CLDR likelySubtags list.
 * This list is curated by the maintainers of Project Fluent and is
 * intended to be used in place of the full likelySubtags list in use cases
 * where full list cannot be (for example, due to the size).
 *
 * This version of the list is based on CLDR 30.0.3.
 */
const likelySubtagsMin = {
  ar: "ar-arab-eg",
  "az-arab": "az-arab-ir",
  "az-ir": "az-arab-ir",
  be: "be-cyrl-by",
  da: "da-latn-dk",
  el: "el-grek-gr",
  en: "en-latn-us",
  fa: "fa-arab-ir",
  ja: "ja-jpan-jp",
  ko: "ko-kore-kr",
  pt: "pt-latn-br",
  sr: "sr-cyrl-rs",
  "sr-ru": "sr-latn-ru",
  sv: "sv-latn-se",
  ta: "ta-taml-in",
  uk: "uk-cyrl-ua",
  zh: "zh-hans-cn",
  "zh-hant": "zh-hant-tw",
  "zh-hk": "zh-hant-hk",
  "zh-mo": "zh-hant-mo",
  "zh-tw": "zh-hant-tw",
  "zh-gb": "zh-hant-gb",
  "zh-us": "zh-hant-us",
};
const regionMatchingLangs = [
  "az",
  "bg",
  "cs",
  "de",
  "es",
  "fi",
  "fr",
  "hu",
  "it",
  "lt",
  "lv",
  "nl",
  "pl",
  "ro",
  "ru",
];
function getLikelySubtagsMin(loc) {
  if (Object.prototype.hasOwnProperty.call(likelySubtagsMin, loc)) {
    return new Locale(likelySubtagsMin[loc]);
  }
  const locale = new Locale(loc);
  if (locale.language && regionMatchingLangs.includes(locale.language)) {
    locale.region = locale.language.toUpperCase();
    return locale;
  }
  return null;
}

/**
 * Negotiates the languages between the list of requested locales against
 * a list of available locales.
 *
 * The algorithm is based on the BCP4647 3.3.2 Extended Filtering algorithm,
 * with several modifications:
 *
 *  1) available locales are treated as ranges
 *
 *    This change allows us to match a more specific request against
 *    more generic available locale.
 *
 *    For example, if the available locale list provides locale `en`,
 *    and the requested locale is `en-US`, we treat the available locale as
 *    a locale that matches all possible english requests.
 *
 *    This means that we expect available locale ID to be as precize as
 *    the matches they want to cover.
 *
 *    For example, if there is only `sr` available, it's ok to list
 *    it in available locales. But once the available locales has both,
 *    Cyrl and Latn variants, the locale IDs should be `sr-Cyrl` and `sr-Latn`
 *    to avoid any `sr-*` request to match against whole `sr` range.
 *
 *    What it does ([requested] * [available] = [supported]):
 *
 *    ['en-US'] * ['en'] = ['en']
 *
 *  2) likely subtags from LDML 4.3 Likely Subtags has been added
 *
 *    The most obvious likely subtag that can be computed is a duplication
 *    of the language field onto region field (`fr` => `fr-FR`).
 *
 *    On top of that, likely subtags may use a list of mappings, that
 *    allow the algorithm to handle non-obvious matches.
 *    For example, making sure that we match `en` to `en-US` or `sr` to
 *    `sr-Cyrl`, while `sr-RU` to `sr-Latn-RU`.
 *
 *    This list can be taken directly from CLDR Supplemental Data.
 *
 *    What it does ([requested] * [available] = [supported]):
 *
 *    ['fr'] * ['fr-FR'] = ['fr-FR']
 *    ['en'] * ['en-US'] = ['en-US']
 *    ['sr'] * ['sr-Latn', 'sr-Cyrl'] = ['sr-Cyrl']
 *
 *  3) variant/region range check has been added
 *
 *    Lastly, the last form of check is against the requested locale ID
 *    but with the variant/region field replaced with a `*` range.
 *
 *    The rationale here laid out in LDML 4.4 Language Matching:
 *      "(...) normally the fall-off between the user's languages is
 *      substantially greated than regional variants."
 *
 *    In other words, if we can't match for the given region, maybe
 *    we can match for the same language/script but other region, and
 *    it will in most cases be preferred over falling back on the next
 *    language.
 *
 *    What it does ([requested] * [available] = [supported]):
 *
 *    ['en-AU'] * ['en-US'] = ['en-US']
 *    ['sr-RU'] * ['sr-Latn-RO'] = ['sr-Latn-RO'] // sr-RU -> sr-Latn-RU
 *
 *    It works similarly to getParentLocales algo, except that we stop
 *    after matching against variant/region ranges and don't try to match
 *    ignoring script ranges. That means that `sr-Cyrl` will never match
 *    against `sr-Latn`.
 */
function filterMatches(requestedLocales, availableLocales, strategy) {
  const supportedLocales = new Set();
  const availableLocalesMap = new Map();
  for (let locale of availableLocales) {
    let newLocale = new Locale(locale);
    if (newLocale.isWellFormed) {
      availableLocalesMap.set(locale, new Locale(locale));
    }
  }
  outer: for (const reqLocStr of requestedLocales) {
    const reqLocStrLC = reqLocStr.toLowerCase();
    const requestedLocale = new Locale(reqLocStrLC);
    if (requestedLocale.language === undefined) {
      continue;
    }
    // 1) Attempt to make an exact match
    // Example: `en-US` === `en-US`
    for (const key of availableLocalesMap.keys()) {
      if (reqLocStrLC === key.toLowerCase()) {
        supportedLocales.add(key);
        availableLocalesMap.delete(key);
        if (strategy === "lookup") {
          return Array.from(supportedLocales);
        } else if (strategy === "filtering") {
          continue;
        } else {
          continue outer;
        }
      }
    }
    // 2) Attempt to match against the available range
    // This turns `en` into `en-*-*-*` and `en-US` into `en-*-US-*`
    // Example: ['en-US'] * ['en'] = ['en']
    for (const [key, availableLocale] of availableLocalesMap.entries()) {
      if (availableLocale.matches(requestedLocale, true, false)) {
        supportedLocales.add(key);
        availableLocalesMap.delete(key);
        if (strategy === "lookup") {
          return Array.from(supportedLocales);
        } else if (strategy === "filtering") {
          continue;
        } else {
          continue outer;
        }
      }
    }
    // 3) Attempt to retrieve a maximal version of the requested locale ID
    // If data is available, it'll expand `en` into `en-Latn-US` and
    // `zh` into `zh-Hans-CN`.
    // Example: ['en'] * ['en-GB', 'en-US'] = ['en-US']
    if (requestedLocale.addLikelySubtags()) {
      for (const [key, availableLocale] of availableLocalesMap.entries()) {
        if (availableLocale.matches(requestedLocale, true, false)) {
          supportedLocales.add(key);
          availableLocalesMap.delete(key);
          if (strategy === "lookup") {
            return Array.from(supportedLocales);
          } else if (strategy === "filtering") {
            continue;
          } else {
            continue outer;
          }
        }
      }
    }
    // 4) Attempt to look up for a different variant for the same locale ID
    // Example: ['en-US-mac'] * ['en-US-win'] = ['en-US-win']
    requestedLocale.clearVariants();
    for (const [key, availableLocale] of availableLocalesMap.entries()) {
      if (availableLocale.matches(requestedLocale, true, true)) {
        supportedLocales.add(key);
        availableLocalesMap.delete(key);
        if (strategy === "lookup") {
          return Array.from(supportedLocales);
        } else if (strategy === "filtering") {
          continue;
        } else {
          continue outer;
        }
      }
    }
    // 5) Attempt to match against the likely subtag without region
    // In the example below, addLikelySubtags will turn
    // `zh-Hant` into `zh-Hant-TW` giving `zh-TW` priority match
    // over `zh-CN`.
    //
    // Example: ['zh-Hant-HK'] * ['zh-TW', 'zh-CN'] = ['zh-TW']
    requestedLocale.clearRegion();
    if (requestedLocale.addLikelySubtags()) {
      for (const [key, availableLocale] of availableLocalesMap.entries()) {
        if (availableLocale.matches(requestedLocale, true, false)) {
          supportedLocales.add(key);
          availableLocalesMap.delete(key);
          if (strategy === "lookup") {
            return Array.from(supportedLocales);
          } else if (strategy === "filtering") {
            continue;
          } else {
            continue outer;
          }
        }
      }
    }
    // 6) Attempt to look up for a different region for the same locale ID
    // Example: ['en-US'] * ['en-AU'] = ['en-AU']
    requestedLocale.clearRegion();
    for (const [key, availableLocale] of availableLocalesMap.entries()) {
      if (availableLocale.matches(requestedLocale, true, true)) {
        supportedLocales.add(key);
        availableLocalesMap.delete(key);
        if (strategy === "lookup") {
          return Array.from(supportedLocales);
        } else if (strategy === "filtering") {
          continue;
        } else {
          continue outer;
        }
      }
    }
  }
  return Array.from(supportedLocales);
}

/**
 * Negotiates the languages between the list of requested locales against
 * a list of available locales.
 *
 * It accepts three arguments:
 *
 *   requestedLocales:
 *     an Array of strings with BCP47 locale IDs sorted
 *     according to user preferences.
 *
 *   availableLocales:
 *     an Array of strings with BCP47 locale IDs of locale for which
 *     resources are available. Unsorted.
 *
 *   options:
 *     An object with the following, optional keys:
 *
 *       strategy: 'filtering' (default) | 'matching' | 'lookup'
 *
 *       defaultLocale:
 *         a string with BCP47 locale ID to be used
 *         as a last resort locale.
 *
 *
 * It returns an Array of strings with BCP47 locale IDs sorted according to the
 * user preferences.
 *
 * The exact list will be selected differently depending on the strategy:
 *
 *   'filtering': (default)
 *     In the filtering strategy, the algorithm will attempt to match
 *     as many keys in the available locales in order of the requested locales.
 *
 *   'matching':
 *     In the matching strategy, the algorithm will attempt to find the
 *     best possible match for each element of the requestedLocales list.
 *
 *   'lookup':
 *     In the lookup strategy, the algorithm will attempt to find a single
 *     best available locale based on the requested locales list.
 *
 *     This strategy requires defaultLocale option to be set.
 */
function negotiateLanguages(
  requestedLocales,
  availableLocales,
  { strategy = "filtering", defaultLocale } = {}
) {
  const supportedLocales = filterMatches(
    Array.from(
      requestedLocales !== null && requestedLocales !== void 0
        ? requestedLocales
        : []
    ).map(String),
    Array.from(
      availableLocales !== null && availableLocales !== void 0
        ? availableLocales
        : []
    ).map(String),
    strategy
  );
  if (strategy === "lookup") {
    if (defaultLocale === undefined) {
      throw new Error(
        "defaultLocale cannot be undefined for strategy `lookup`"
      );
    }
    if (supportedLocales.length === 0) {
      supportedLocales.push(defaultLocale);
    }
  } else if (defaultLocale && !supportedLocales.includes(defaultLocale)) {
    supportedLocales.push(defaultLocale);
  }
  return supportedLocales;
}


window.negotiateLanguages = negotiateLanguages;
