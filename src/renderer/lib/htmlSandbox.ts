// SPDX-License-Identifier: Apache-2.0

/**
 * Utilities for safe HTML rendering inside sandboxed srcDoc iframes.
 *
 * Problem: In srcDoc iframes, clicking `<a href="#section">` triggers full
 * navigation to `about:srcdoc#section`. Since srcDoc content is NOT persisted
 * across navigations, the iframe renders a blank page.
 *
 * Solution: Inject a tiny click-interceptor script that:
 *   - Anchor links (#id) → `element.scrollIntoView()` (no navigation)
 *   - External links       → `preventDefault()` (avoid blank iframe)
 *
 * Only needed for interactive iframes (`sandbox="allow-scripts"`).
 * Thumbnail iframes (`sandbox=""` + `pointer-events-none`) are unaffected.
 */

const LINK_INTERCEPT_SCRIPT = `
<script>
(function () {
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href) return;

    // Anchor link — smooth-scroll to target element
    if (href.charAt(0) === '#') {
      e.preventDefault();
      var id = decodeURIComponent(href.slice(1));
      var el = document.getElementById(id)
        || document.querySelector('[name="' + id.replace(/"/g, '\\\\"') + '"]');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    // External link — block navigation to prevent blank iframe
    e.preventDefault();
  });
})();
</script>`

/**
 * Wraps HTML content with a link-interceptor script that prevents
 * blank-page navigation inside sandboxed srcDoc iframes.
 */
export function wrapHtmlForSafePreview(html: string): string {
  return html + LINK_INTERCEPT_SCRIPT
}
