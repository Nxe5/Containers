/**
 * Injected on demand (only when the user clicks "Fill login" in the popup)
 * to fill the current page's username/password fields. Loaded as a static
 * file via tabs.executeScript rather than a code string, and receives the
 * credential over runtime messaging instead of having it interpolated into
 * injected source.
 */
(() => {
  function setValue(el, value) {
    if (!el) return;
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fillCredential(account, password) {
    const passwordField = document.querySelector('input[type="password"]');
    const scope = (passwordField && passwordField.form) || document;
    let usernameField = scope.querySelector(
      'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]'
    );
    if (!usernameField) {
      usernameField = scope.querySelector('input[type="text"], input:not([type])');
    }

    if (usernameField && account) setValue(usernameField, account);
    if (passwordField && password) setValue(passwordField, password);
  }

  function handler(message) {
    if (message?.type !== 'fill-login-credential') return;
    browser.runtime.onMessage.removeListener(handler);
    fillCredential(message.account, message.password);
  }

  browser.runtime.onMessage.addListener(handler);
})();
