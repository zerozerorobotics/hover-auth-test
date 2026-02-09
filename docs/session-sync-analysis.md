# Analysis of `snippets/session-sync.liquid`

This document provides a multi-level analysis of the `snippets/session-sync.liquid` file, breaking down its functionality from business requirements to technical implementation.

## 1. Business & Functional Level
**Goal:** Seamlessly synchronize user authentication state between Shopify (the storefront) and Keycloak (the identity provider).

*   **Auto-Login (SSO):** Users who are logged into other services (via Keycloak) should automatically be logged into the Shopify store without needing to re-enter credentials.
*   **Session Synchronization:** If a user logs out from another service (terminating the Keycloak session), they should also be logged out of Shopify to maintain security.
*   **Loop Prevention:** Prevents the user from being stuck in an endless loop of redirects between Shopify and Keycloak.

## 2. Architecture & Flow
The script implements a client-side (browser-based) OIDC synchronization flow.

### A. The "Probe" (Anonymous Users)
1.  **Trigger:** User visits the store and is **not** logged in (`customer` object is null).
2.  **Check:** Script checks `sessionStorage` for a `keycloak_checked` flag.
    *   **If checked recently:** Stops (to avoid loops).
    *   **If NOT checked:** Initiates the probe.
3.  **Action:** Redirects the browser to Keycloak's `/auth` endpoint with:
    *   `prompt=none`: Requests a silent check.
    *   `response_type=code`: Standard OIDC flow.
    *   `state=PROBE`: Marks this request as a probe.
4.  **Outcome:**
    *   **Session Exists:** Keycloak redirects back with a code, logging the user in.
    *   **No Session:** Keycloak redirects back (usually with an error or just to the URI), and the script sets the checked flag to stop further attempts.

### B. The "Session Monitor" (Logged-in Users)
1.  **Trigger:** User is **logged in** (`customer` object exists).
2.  **Action:** Sends a `fetch` request to Keycloak (`/session-status`) with the Session ID (`sid`).
3.  **Frequency:**
    *   On page load.
    *   Whenever the tab becomes visible (`visibilitychange` event).
4.  **Outcome:**
    *   **Active:** Do nothing.
    *   **Inactive:** Redirect to `/account/logout` to force a Shopify logout.

### C. The "Bounce Page" (`/pages/session-sync`)
Acts as a dedicated landing endpoint to capture session data before redirecting to the final destination.
1.  Extracts `sid` from URL hash or query params.
2.  Saves `sid` to `localStorage`.
3.  Redirects to `target` param or `/account`.

## 3. Technical Implementation Details

### Configuration
*   **Environment Detection:** 
    *   Production: `shopify-fake-store` (on `latentseek.com`?? logic seems inverted or specific to a test setup).
    *   Default: `shopify-fake-store-central`.
*   **Endpoints:**
    *   Auth: `.../protocol/openid-connect/auth`
    *   Status: `.../hoverair/session-status` (Custom endpoint?)

### State Management
*   **`localStorage` (`zz_session_id`)**: Stores the Keycloak Session ID. Used for the active session check. Persists across tabs.
*   **`sessionStorage`**:
    *   `keycloak_checked`: Boolean flag to indicate a probe has been sent in this session.
    *   `keycloak_last_probe_at`: Timestamp of the last probe to enforce cooldowns.
    *   `explicit_logout`: Flag set when user manually logs out, preventing immediate auto-login logic.

### Loop Prevention Strategies
1.  **Session Storage Flag:** `keycloak_checked` prevents probing multiple times per session.
2.  **Time-based Cooldown:** `PROBE_COOLDOWN_MS = 2 minutes` prevents rapid re-probing.
3.  **Explicit Logout Guard:** If `explicit_logout` is set, the script terminates immediately.

## 4. Potential Issues & Considerations

1.  **Custom Endpoint Dependency:** `.../hoverair/session-status` helps reduce overhead but requires Keycloak to have this specific custom endpoint enabled. Standard OIDC usually uses `userinfo` or a token introspection endpoint, which might be heavier or require different privileges.
2.  **Third-Party Cookies:** The `prompt=none` flow often relies on third-party cookies (if Keycloak is on a different domain). Using `monitor-session` iframe or similar strategies is the modern standard, but this script uses a full redirect, which is more robust against cookie partitioning *if* checks are infrequent, but `prompt=none` might still fail in Safari/ITP environments if domains differ entirely.
3.  **Race Conditions:**
    *   Multiple tabs opening enabling `checkSessionStatus` simultaneously.
    *   The script uses a simple "check and redirect" approach, which is generally safe but relies on the browser handling the redirect speed.
4.  **Hardcoded URLs:**
    *   `https://auth-test.zerozerorobotics.com` is hardcoded. Moving to production requires code changes.
    *   Client ID logic (`latentseek.com`) seems specific to a staging/test environment context.

## 5. Deployment Context
Included in `layout/theme.liquid` (Line 302), verifying it is a global script that runs on every storefront page. This ensures coverage but also means any error in this script (like a syntax error or infinite loop) could break the entire site experience. The `try/catch` blocks (or lack thereof in the main IIFE) are important.
*   *Note:* The fetch in `checkSessionStatus` has a `.catch()` which is good practice to avoid checking unavailability breaking the page.
