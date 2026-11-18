// =====================================================================================
//  auth.js
//  MI-CHIPS (NSF #2606117): student sign-in, which identifies the learner for progress
//  tracking. It is not a password login.
//    • VSU ID: "V00" followed by exactly 6 digits (the student types only the digits)
//    • First and last name
//  Stored only on this device (localStorage when "remember" is ticked, otherwise for this
//  browser session). Nothing is sent to a server, and it is never included in AI requests.
// =====================================================================================

const KEY = 'michips.user';
const ID_PREFIX = 'V00';
const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' -]{0,39}$/;

/** Digits a student typed or pasted → the 6-digit part of the ID ("V00123456" → "123456"). */
export function idDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 8 && d.startsWith('00')) d = d.slice(2); // pasted the full V00xxxxxx
  return d.slice(0, 6);
}

export function validate({ digits, first, last }) {
  const errors = {};
  if (!/^\d{6}$/.test(digits)) errors.id = 'Enter the 6 digits after V00.';
  if (!NAME_RE.test(first.trim())) errors.first = 'Enter your first name (letters only).';
  if (!NAME_RE.test(last.trim())) errors.last = 'Enter your last name (letters only).';
  return errors;
}

export function currentUser() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const u = JSON.parse(store.getItem(KEY) || 'null');
      if (u && /^V00\d{6}$/.test(u.id) && u.first && u.last) return u;
    } catch { /* blocked or malformed */ }
  }
  return null;
}

function save(user, remember) {
  try {
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(user));
  } catch { /* storage blocked: signed in for this page only */ }
}

export function signOut() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  location.reload();
}

/** Shows the sign-in screen until a valid ID and name are entered. Resolves with the user. */
export function requireSignIn() {
  const existing = currentUser();
  if (existing) return Promise.resolve(existing);

  const screen = document.getElementById('signin');
  const form = document.getElementById('signin-form');
  const idInput = document.getElementById('signin-id');
  const first = document.getElementById('signin-first');
  const last = document.getElementById('signin-last');
  const remember = document.getElementById('signin-remember');
  const err = (name, msg) => {
    const el = document.getElementById(`signin-${name}-err`);
    el.textContent = msg || '';
    document.getElementById(`signin-${name === 'id' ? 'id' : name}`).setAttribute('aria-invalid', msg ? 'true' : 'false');
  };

  screen.hidden = false;
  idInput.focus();
  // Digits only, as you type or paste.
  idInput.addEventListener('input', () => {
    const d = idDigits(idInput.value);
    if (idInput.value !== d) idInput.value = d;
    if (/^\d{6}$/.test(d)) err('id', '');
  });

  return new Promise((resolve) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = { digits: idDigits(idInput.value), first: first.value, last: last.value };
      const errors = validate(input);
      err('id', errors.id); err('first', errors.first); err('last', errors.last);
      if (Object.keys(errors).length) {
        (errors.id ? idInput : errors.first ? first : last).focus();
        return;
      }
      const user = { id: ID_PREFIX + input.digits, first: input.first.trim(), last: input.last.trim(), signedInAt: new Date().toISOString() };
      save(user, remember.checked);
      screen.hidden = true;
      resolve(user);
    });
  });
}
