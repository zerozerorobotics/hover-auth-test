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
