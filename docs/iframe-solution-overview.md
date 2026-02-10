# Iframe-based Session Sync: Solution Overview

This document provides a high-level outline, benefits (pros), and challenges (cons) of the Iframe-based Silent Check solution for session synchronization.

## 1. Solution Outline

### Mechanism
1.  **Hidden Iframe**: The script creates an invisible `<iframe>` pointing to the Keycloak Probe URL with `prompt=none`.
2.  **Keycloak Logic**: Keycloak checks for an existing session cookie *without* displaying any UI.
3.  **Callback**:
    *   **Success**: Redirects iframe to `redirect_uri` with `code` or `sid`.
    *   **Failure**: Redirects iframe to `redirect_uri` with `error=login_required`.
4.  **Message Passing**: The `redirect_uri` page (inside iframe) uses `postMessage()` to send the result back to the parent window.
5.  **Reaction**: Parent window updates state (logs in or marks as anonymous) without refreshing the main page.

### Implementation Requirements
*   **Callback Page**: A lightweight HTML file is required to handle the Keycloak redirect and trigger `postMessage`.
*   **CSP/CORS**: Security policies must allow the iframe to load the Auth URL.

## 2. Pros (Benefits)

*   **Zero UX Glitch**: The user sees absolutely nothing—no page reload, no URL bar flickering, no navigation.
*   **Instant Synchronization**: Because the check is "cheap" (no reload), we can run it frequently (e.g., on every tab focus), ensuring near-instant sync across tabs.
*   **Industry Standard**: This is the compliant way to handle OIDC Session Management.

## 3. Cons (Challenges & Risks)

*   **Third-Party Cookie Blocking (ITP)**:
    *   **The Issue**: Modern browsers (Safari, Firefox, Chrome Incognito) block third-party cookies by default. If Keycloak (`auth.example.com`) and Store (`store.example.com`) are on different domains, the iframe cannot read the Keycloak session cookie.
    *   **Impact**: The check silently fails (returns `login_required`) even if the user is logged in.
    *   **Mitigation**: Requires mapping Keycloak to a subdomain of the store (e.g., `auth.store.com` matching `www.store.com`) to make cookies First-Party.

*   **Implementation Complexity**: Requires hosting a dedicated callback artifact and managing cross-window communication (`postMessage`).
