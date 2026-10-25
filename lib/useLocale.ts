import { useSyncExternalStore } from 'react';
import { getLocale, getLanguagePreference, subscribeLocale } from './i18n';

export function useLocale() {
  useSyncExternalStore(subscribeLocale, () => `${getLanguagePreference()}:${getLocale()}`);
  return { locale: getLocale(), preference: getLanguagePreference() };
}
