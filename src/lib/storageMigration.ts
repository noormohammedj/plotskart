// One-time move of browser storage from the old pp-* keys to plotskart-* (theme, demo sign-ins, demo resume key),
// so nobody is signed out or loses their theme after the rebrand. Runs before anything reads storage.
const OLD = 'pp-';
const NEW = 'plotskart-';

function migrate(store: Storage | undefined) {
  if (!store) return;
  const old: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith(OLD)) old.push(k);
  }
  for (const k of old) {
    const target = NEW + k.slice(OLD.length);
    const value = store.getItem(k);
    if (value !== null && store.getItem(target) === null) store.setItem(target, value);
    store.removeItem(k);
  }
}

for (const get of [() => window.localStorage, () => window.sessionStorage]) {
  try { migrate(get()); } catch { /* storage blocked (private mode) */ }
}

export {};
