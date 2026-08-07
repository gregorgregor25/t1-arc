package app.daymark.glooko

import org.json.JSONObject

/**
 * Builds the short-lived script used to populate Glooko's own sign-in form.
 * Credentials stay inside the native connector and this script must never be
 * logged, returned through the Expo module, or included in diagnostics.
 */
internal fun glookoLoginScript(credentials: GlookoCredentials): String {
  val email = JSONObject.quote(credentials.email)
  val password = JSONObject.quote(credentials.password)
  return """
    (function () {
      try {
        const email = $email;
        const password = $password;
        const visible = (element) => {
          if (!element) return false;
          const style = window.getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' &&
            bounds.width > 0 && bounds.height > 0;
        };
        const emailInput = Array.from(document.querySelectorAll(
          'input[type="email"],input[autocomplete="username"],' +
          'input[name*="email" i],input[name*="login" i]'
        )).find(visible);
        const passwordInput = Array.from(document.querySelectorAll(
          'input[type="password"],input[autocomplete="current-password"]'
        )).find(visible);
        if (!emailInput || !passwordInput) return 'missing-form';
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;
        const setValue = (input, value) => {
          if (setter) setter.call(input, value);
          else input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        setValue(emailInput, email);
        setValue(passwordInput, password);
        const form = passwordInput.form || emailInput.form ||
          passwordInput.closest('form') || emailInput.closest('form');
        if (!form) return 'missing-form';
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else {
          const submit = form.querySelector(
            'button[type="submit"],input[type="submit"],button:not([type])'
          );
          if (submit) submit.click();
          else form.submit();
        }
        return 'submitted';
      } catch (_) {
        return 'failed';
      }
    })();
  """.trimIndent()
}
