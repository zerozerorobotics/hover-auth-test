# Session Sync: Iframe-based Silent Check Solution

This document details the "Silent Check" pattern using a hidden iframe, which is the proposed improvement to resolve UX issues in the current session sync implementation.

## 1. How it works

1.  **Creation**: Instead of `window.location.href = probeUrl`, the script creates a hidden `<iframe>` element and appends it to the `body`.
2.  **Navigation**: The iframe's `src` is set to the Keycloak Probe URL (`prompt=none`).
3.  **Keycloak Response**:
    *   **If Logged In**: Keycloak redirects the *iframe* to the callback URL with `code=...` or `sid=...`.
    *   **If Not Logged In**: Keycloak redirects the *iframe* to the callback URL with `error=login_required`.
4.  **Communication**: The callback page (loaded inside the iframe) executes a small script to send a message to the parent window (the main site) via `window.parent.postMessage()`.
    *   Message: `{ status: 'active', sid: '...' }` or `{ status: 'inactive' }`.
5.  **Reaction**: The main site listens for the `message` event.
    *   If `active`: It captures the SID and triggers a login flow (or reload) only when necessary.
    *   If `inactive`: It updates the `last_probe_at` timestamp and does nothing else.

## 2. Benefits

*   **Zero Glitch**: The user sees absolutely nothing. No URL change, no reload, no flash.
*   **Reduced Friction**: We can probe much more frequently (e.g., every time the tab is focused) because a "miss" (user still anonymous) costs nothing in terms of UX.
*   **Faster Sync**: Because we can probe more often, cross-site login synchronization happens almost instantly instead of waiting for a 2-minute cooldown.

## 3. Implementation Requirements

1.  **Callback Page**: A dedicated, lightweight HTML file (or Liquid template) is needed to serve as the `redirect_uri` for the iframe. It must contain the logic to `postMessage` back to the parent.
2.  **CORS/CSP**: Content Security Policy must allow loading the Keycloak URL in an iframe (usually fine for `prompt=none` checks, but `X-Frame-Options` on Keycloak login pages must be considered if we ever show UI).

## 4. Industry Standards & Modern Challenges

### Is this the best practice?

The "Iframe-based Silent Check" (OIDC Session Management with `prompt=none`) **is the established industry standard** for Single Page Applications (SPAs) and frontend-heavy sites to detect session status without user interaction.

*   **OpenID Connect Spec**: The OIDC Back-Channel & Front-Channel Logout specs rely heavily on this pattern.
*   **Adoption**: It is used by major identity providers like Auth0, Okta, and Azure AD for their JS SDKs.

### The "Third-Party Cookie" Challenge

**However**, this pattern faces a critical challenge in modern browsers due to **Intelligent Tracking Prevention (ITP)** and third-party cookie blocking (Safari, Firefox, and soon Chrome).

*   **Scenario**:
    *   **Store Domain**: `store.hoverair.com`
    *   **Auth Domain**: `auth-test.zerozerorobotics.com`
*   **Problem**: When the iframe (hosted on `auth-test...`) loads inside `store.hoverair.com`, the browser treats Keycloak's session cookie as a **Third-Party Cookie**.
    *   **Safari/Firefox**: By default, they may **block** this cookie.
    *   **Result**: Keycloak will think the user is *not logged in* (even if they are!), and return `error=login_required`.
    *   **Consequence**: The silent check fails, and we fall back to the "Top-Level Redirect" (which works because it's a first-party navigation).

### Recommendation for Production

To make the "Silent Check" robust and future-proof:

1.  **Use a Custom Limit (Same-Site Cookie Strategy)**:
    *   Map Keycloak to a subdomain of the store: e.g., `auth.hoverair.com`.
    *   If the store is `www.hoverair.com` and Keycloak is `auth.hoverair.com`, the cookie is considered **First-Party** (or Same-Site), and browsers will allow it.
    *   **Verdict**: This is the **Gold Standard** configuration.

2.  **Hybrid Approach**:
    *   Attempt the Silent Check (Iframe) first.
    *   If it returns `login_required` (could be true logout OR cookie blocked), rely on the Top-Level Redirect (with cooldown) as a fallback mechanism.
