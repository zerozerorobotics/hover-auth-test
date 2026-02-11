# Keycloak User ID Integration with GA4

## 1. Requirement
**Goal**: Capture the **User ID** from Keycloak's authenticated session and send it to **Google Analytics 4 (GA4)** as a user attribute/property (`user_id`).

## 2. Current Architecture
-   **Session Sync Mechanism**: The project uses `snippets/session-sync-v2.liquid` (V4 Architecture) to synchronize sessions between Shopify and Keycloak.
-   **Implementation**: A hidden iframe loads `https://static.zerozeroplatform.com/session-check` (a Cloudflare Worker).
-   **Current Response**: The worker checks cookies and returns `{ status: 'active' }` via `postMessage`.
-   **Gap**: The response does not contain the User ID, preventing GA4 from stitching sessions effectively.

## 3. Feasibility Analysis

### Technical Challenge
The current "Session Check" uses the **Authorization Code Flow** (`response_type=code`).
-   Keycloak returns an opaque `code`.
-   This `code` cannot be decoded by the frontend/iframe to reveal user identity. It requires a backend token exchange, which is not available in this static/worker architecture.

### Proposed Solution: Hybrid Flow
To retrieve the User ID without a backend, we must switch to **OIDC Hybrid Flow**.
-   **Mechanism**: Request `response_type=code id_token`.
-   **Result**: Keycloak returns both an authorization code (for potential backend use) and an `id_token` (JWT) directly in the URL fragment.
-   **Decryption**: The worker can Base64-decode the `id_token` (no secret needed) to extract the `sub` (Subject/User ID).

### Critical Prerequisite
The Keycloak Client (`shopify-fake-store` / `shopify-fake-store-central`) **MUST** have **"Implicit Flow"** (or "Standard Flow" + "Implicit Flow") enabled in its settings. If disabled, Keycloak will reject the request.

## 4. Security & Privacy Assessment

### Industry Standard
Using a persistent, cross-device identifier (like a database UUID) is the recommended best practice for GA4 User-ID measurement. The OIDC Hybrid Flow is the standard pattern for retrieving this identity in client-side applications (SPAs).

### Privacy Safety (UUID = Opaque)
-   **Opaque**: The User ID (e.g., `f81d4fae-...`) is a random UUID with **no semantic meaning**. It does not reveal the user's name, email, or physical identity. It is a pseudonym.
-   **Safe**: Google Analytics strictly prohibits PII (Personally Identifiable Information) like emails. Sending an opaque UUID **complies with Google's Terms of Service** and privacy regulations (GDPR/CCPA) as it allows behavioral tracking without exposing real-world identity.

### Security Risks
-   **Token Exposure**: The `id_token` is visible in the URL fragment. Browsers do not send fragments to servers, so it is not logged by intermediaries.
-   **Secret Leakage**: This flow does **not** requires the `client_secret`, so no backend secrets are exposed.

## 5. Implementation Plan

### Phase 1: Backend (Cloudflare Worker)
**File**: `workers/session-check.js`
1.  Update logic to parse `id_token` from `window.location.hash`.
2.  Decode JWT payload to extract `sub`.
3.  Include `userId` in the `postMessage` payload:
    ```json
    { "type": "KEYCLOAK_SESSION_STATUS", "status": "active", "userId": "..." }
    ```

### Phase 2: Frontend (Liquid)
**File**: `snippets/session-sync-v2.liquid`
1.  Update `createProbeIframe` URL to use `response_type=code id_token`.
2.  Update `handleIframeMessage` to listen for `userId`.
3.  Push Data to GA4:
    ```javascript
    if (event.data.userId) {
      // Support gtag.js
      if (typeof gtag === 'function') {
        gtag('set', 'user_properties', { user_id: event.data.userId });
        gtag('config', 'G-XXXXXX', { 'user_id': event.data.userId });
      }
      // Support GTM (dataLayer)
      if (window.dataLayer) {
        window.dataLayer.push({ event: 'keycloak_user_identified', userId: event.data.userId });
      }
    }
    ```

## 6. Technical Deep Dive: Why Hybrid Flow?

### The Problem: "No Backend" Constraint
In a traditional web app (e.g., PHP, Java, Rails), the server holds a `client_secret`.
1.  Browser sends `response_type=code`.
2.  Keycloak returns a `code`.
3.  Browser sends `code` to **Server**.
4.  **Server** exchanges `code` + `client_secret` for `access_token` + `id_token`.
5.  **Server** reads `id_token`, extracts User ID, and tells the browser.

In our architecture (Shopify + Static Worker):
*   We have **no backend server** that can safely hold the `client_secret`.
*   The Cloudflare Worker is a public static asset handler; it cannot perform the secret exchange securely or maintain session state for us.
*   Therefore, the `code` is useless to us for getting user info—we can't exchange it.

### The Solution: OIDC Hybrid Flow (`code id_token`)
By adding `id_token` to the request, we tell Keycloak:
> "Please give me the Identity Token **immediately** in the browser URL, along with the code."

*   **Mechanism**: The `id_token` is a **JWT (JSON Web Token)**. containing the user's profile data (like `sub`, `email`, etc.).
*   **Verification**: The Worker receives this token in the URL hash (`#id_token=...`). It does **not** need to call Keycloak to validate it. It can simply **decode** the Base64 string to read the `sub` (User ID).
*   **Safety**: This token is signed by Keycloak. While a full backend validation would check the signature, for **analytics purposes** (where the user is checking their *own* session), simple decoding is sufficient and standard practice for client-side apps.
    *   **Safety**: This token is signed by Keycloak. While a full backend validation would check the signature, for **analytics purposes** (where the user is checking their *own* session), simple decoding is sufficient and standard practice for client-side apps.

## 7. Analysis: Dynamic Login State & Reporting Logic
The user's login state is not static; it changes based on user interactions (Login, Logout, Session Expiry). We must handle these transitions carefully to ensure accurate data reporting.

### A. When to Report (The "Active" State)
We should **only** report the User ID to GA4 when:
1.  The session check returns `status: 'active'`.
2.  The `userId` field is present and valid.

**Why?**
*   This confirms the user is authenticated in Keycloak.
*   Even if the user is *strictly* "Anonymous" in Shopify (e.g., just arrived, session sync pending), reporting the Keycloak User ID immediately allows GA4 to **stitch** the pre-login behavior (page view, initial clicks) to the authenticated user profile once the sync completes.

### B. When NOT to Report (The "Inactive" State)
If the session check returns `status: 'inactive'` or `status: 'error'`, we must **not** report the User ID.
*   **Action**: Do nothing (or explicitly push `user_id: null` if using a Single Page Application framework that persists state).
*   **Scenario**: User logs out. The page redirects to the logout confirmation. The new page loads. The session check returns `inactive`. GA4 initializes without a User ID. This correctly attributing subsequent events to an anonymous user.

### C. The "Race Condition" (GA4 vs. Session Check)
The session check is asynchronous (iframe loading + worker response).
1.  **Page Load**: GA4 initializes (Anonymous).
2.  **Delay (e.g., 500ms)**: Session Check runs.
3.  **Session Active**: We set `user_id`.

**Impact**:
*   Events fired *during* the 500ms delay (e.g., `page_view`) might initially be anonymous.
*   **Resolution**: GA4's "Session Stitching" feature is designed to handle this. When the `user_id` is set mid-session, GA4 retroactively associates the session's previous events with that user.
*   **Recommendation**: We accept this slight delay as it avoids blocking the UI (unlike a synchronous backend check).

### D. Subtlety: Updates during "Visibility Change"
Our script re-checks session status on `visibilitychange` (tab focus).
*   **Scenario**: User logs in on Tab A. Switches to Tab B.
*   **Behavior**: Tab B detects `active`.
*   **Action**: We report User ID again.
*   **Safety**: `gtag config` / `set` is idempotent. Reporting the *same* User ID multiple times in a session is safe and reinforces the session state. It does not duplicate users.

## 8. Industry Best Practice: "Late Identification"

### The Question
> "Since the user is initially 'Anonymous' (at page load) and only identified after a delay (e.g., 500ms), should we still report the User ID?"

### The Answer: YES, Absolutely.
This is the **standard pattern** for Single Page Applications (SPAs) and client-side authentication. Google Analytics 4 is specifically architected to handle this via a feature called **"Session Stitching"**.

1.  **Phase 1 (Anonymous)**:
    *   User lands on page. `page_view` event fires.
    *   GA4 assigns a random `client_id` (cookie).
    *   Event is logged as "Anonymous User".

2.  **Phase 2 (Identification)**:
    *   500ms later, our Session Check completes. We call `gtag('set', 'user_id', 'UUID')`.
    *   **Magic**: GA4 now knows this session belongs to 'UUID'.
    *   **Stitching**: GA4 retroactively associates the earlier `page_view` (from Phase 1) with this User ID in its processing pipeline.

### Why this is Critical
If you *don't* report the ID because it was "late", you lose the ability to track this user across devices.
*   **Without ID**: A user on Phone and Desktop counts as **2 Users**.
*   **With ID (even late)**: A user on Phone and Desktop counts as **1 User** with a unified journey.

**Conclusion**: Always report the User ID as soon as it is available. The slight delay is handled automatically by the analytics platform.

## 9. Handling Logout

### The Question
> "How should we tell GA4 that the user has logged out?"

### Best Practice for Our Architecture (Redirect-based)
**Do Nothing.**

**Why?**
1.  **State Reset**: Our logout flow involves a full page redirect to Keycloak (`/account/logout` -> Keycloak -> Post-Logout Page).
2.  **Fresh Initialization**: When the user lands on the post-logout page, the browser re-initializes the GA4 library from scratch.
3.  **No User ID**: Our `session-sync-v2.liquid` script runs, checks the session, finds it **inactive**, and *does not set* the User ID.
4.  **Result**: GA4 naturally treats this new page view (and subsequent events) as belonging to an **Anonymous User** (same `client_id`, but no `user_id`).

### Anti-Patterns to Avoid
*   ❌ **Making an explicit call with `user_id: null` or `user_id: ''`**:
    *   This is generally discouraged in GA4 property configuration unless you are building a strict Single Page Application (SPA) without refreshes.
    *   Sending an empty string can sometimes result in a literal user ID of `""` or `"null"` in reports, polluting your data.
*   ❌ **Sending a specific "Logged Out" event**:
    *   GA4 automatically infers session ends based on inactivity or campaign changes. You *can* send a custom `logout` event if you want to track *the action of clicking logout*, but you don't need it for identity management.

### Summary
Since we rely on **redirects** for login/logout, the browser's natural lifecycle handles the state cleanup for us. We just need to ensure our code **does not** report a User ID when the session is inactive (which we covered in Section 7B).

