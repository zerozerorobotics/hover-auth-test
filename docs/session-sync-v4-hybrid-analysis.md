# Analysis: Session Sync V4 (Hybrid Strategy)

This document analyzes the user's proposal to combine the V2 (Immediate Redirect) and V3 (Background Iframe) strategies to achieve optimal session synchronization across multiple domains (`us-test` and `central-test`).

## Core Concept
The goal is to eliminate the trade-off between **Perceived Performance** (V3) and **Authenticated State Consistency** (V2).

*   **V2 (Redirect Strategy)**: Ensures the user lands on the page in a fully authenticated state, but incurs a redirect penalty for *everyone* (including anonymous users).
*   **V3 (Iframe Strategy)**: Loads the page immediately, but causes a "Flicker" (Guest -> Logged In) as the iframe check completes.

## Proposed Solution: Hint-Based Hybrid Check
The solution is to use a **Shared Hint Cookie** (`KC_LOGGED_IN`) on the parent domain (`.zerozeroplatform.com`) to intelligently decide which strategy to use.

### 1. The Strategy Logic

#### Phase A: Initial Page Parse (Head Script)
*Trigger: Immediate execution in `<head>`.*
1.  **Check Hint Cookie**: Does `document.cookie` contain `KC_LOGGED_IN=1`?
2.  **YES (Hint Found)**:
    *   **Assumption**: User is likely logged in on a sister site.
    *   **Action**: Execute **V2 (Immediate Redirect)**.
    *   **Result**: User is redirected to Keycloak (`prompt=none`) before Body paints. They return authenticated. **Zero Flicker.**
3.  **NO (Hint Missing)**:
    *   **Assumption**: User is likely anonymous.
    *   **Action**: Skip redirect. Render page immediately. **Zero Delay.**

#### Phase B: Post-Load (Body Script)
*Trigger: `DOMContentLoaded`.*
1.  **Execute V3 (Background Iframe)**:
    *   Regardless of Hint Cookie, perform a silent Iframe check.
    *   **Purpose**:
        *   **Validation**: Verify the Hint was correct (cookie might be stale).
        *   **Logout Sync**: Detect if session has ended in the background tab.
        *   **Fallback**: If Hint was missing but session *does* exist (edge case), login the user (with flicker, but better than nothing).

### 2. Implementation Requirements

To implement this meaningful V4 strategy, we need:

1.  **Shared Cookie Domain**: Keycloak and Stores must share a root domain (Done: `.zerozeroplatform.com`).
2.  **Writing the Hint**:
    *   When user logs in on *any* store, we must write `KC_LOGGED_IN=1; Domain=.zerozeroplatform.com; Path=/`.
    *   *Note*: Keycloak itself won't write this readable cookie. We must do it in our `login success` handler in `session-sync-v2.liquid` (or `v4`).
3.  **Reading the Hint**:
    *   `session-sync-v4.liquid` needs logic in `<head>` to read this cookie.

### 3. Pros & Cons

| Feature | V2 Only | V3 Only | V4 (Hybrid Hint) |
| :--- | :--- | :--- | :--- |
| **Anonymous UX** | Slow (Redirect Loop) | Fast (Immediate) | **Fast (Immediate)** |
| **Logged-In UX** | Fast (No Flicker) | Flicker (Guest->Auth) | **Fast (No Flicker)** |
| **Complexity** | Low | Medium | **High** |
| **Reliability** | High | High (with Worker) | **High** |

## 3. Implementation Design (Hint Cookie)

This section details how `KC_LOGGED_IN` is managed.

### 3.1. Cookie Specification
*   **Name**: `KC_LOGGED_IN`
*   **Value**: `1`
*   **Domain**: `.zerozeroplatform.com` (Crucial: Must be shared across subdomains)
*   **Path**: `/`
*   **Max-Age**: `2592000` (30 days - or match Keycloak session lifetime)
*   **SameSite**: `Lax`
*   **Secure**: `true`

### 3.2. Lifecycle Management

#### A. Setting the Cookie (Login)
We need to set this cookie when we are *certain* the user has logged in.
**Location**: `snippets/session-sync-v2.liquid` -> `handleIframeMessage` -> `status === 'active'`
**Why**: When the V3/V2 check succeeds and we redirect to `/account/login`, we know the user is authenticated.
**Code**:
```javascript
function setHintCookie() {
  var domain = '.zerozeroplatform.com';
  document.cookie = "KC_LOGGED_IN=1; path=/; domain=" + domain + "; max-age=2592000; samesite=lax; secure";
}
```

#### B. Clearing the Cookie (Logout)
We must clear this cookie when the user logs out to prevent infinite redirect loops on the next visit (V2 would see the hint, redirect to Keycloak, Keycloak sees no session, redirects back, loop).
**Location**: `layout/theme.liquid` (Logout Link) OR `snippets/session-sync-v2.liquid` (Inactive Session Detection).
**Code**:
```javascript
function clearHintCookie() {
  var domain = '.zerozeroplatform.com';
  document.cookie = "KC_LOGGED_IN=; path=/; domain=" + domain + "; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}
```

### 3.3. Phase 1 Check (The "V2" Part)
This logic must run in `<head>` **before** anything else.
```javascript
// Check for Hint
if (document.cookie.indexOf('KC_LOGGED_IN=1') !== -1 && !window.shopifyUserLoggedIn) {
  // Hint exists, but Shopify says we are anonymous.
  // ACTION: Immediate Redirect (V2 Style)
  window.location.href = CONFIG.keycloakUrl + "...&prompt=none...";
}
```

### 3.4. Phase 2 Check (The "V3" Part)
Runs on `DOMContentLoaded`.
*   Standard Iframe Check.
*   **Correction Logic**:
    *   If Status = `active`: `setHintCookie()` (Refresh/Set it).
    *   If Status = `inactive`: `clearHintCookie()` (Self-Correction if hint was wrong).

