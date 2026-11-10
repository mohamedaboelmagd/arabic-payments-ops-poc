import { signal } from '@angular/core';
import { DEMO_USERS } from '../../../backend/src/domain/seed';
import type { Lang } from './i18n';

const LANG_KEY = 'payments-ops-poc:lang';
const ACTOR_KEY = 'payments-ops-poc:actor';

function storedLang(): Lang {
  const v = localStorage.getItem(LANG_KEY);
  return v === 'en' || v === 'ar' ? v : 'ar';
}

export const currentLang = signal<Lang>(typeof localStorage === 'undefined' ? 'ar' : storedLang());
export const currentActor = signal(typeof localStorage === 'undefined' ? 'layla.maker' : localStorage.getItem(ACTOR_KEY) ?? 'layla.maker');
export const demoUsers = DEMO_USERS;

export function setLang(lang: Lang) {
  currentLang.set(lang);
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function setActor(username: string) {
  currentActor.set(username);
  localStorage.setItem(ACTOR_KEY, username);
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLang();
  document.documentElement.dir = currentLang() === 'ar' ? 'rtl' : 'ltr';
}
