# Implementation Plan: Iframe-based Session Sync (V2 Module)

This detailed plan outlines the steps to implement the "Silent Check Iframe" strategy in a new module (`session-sync-v2.liquid`), leaving the existing implementation intact for fallback or A/B testing.

## Goal
Implement a non-intrusive, silent session check using an `<iframe>` to detect Keycloak session status without reloading the Shopify page. This will be encapsulated in a new V2 module.

## Constraints & Assumptions
*   **Keycloak Domain**: The Keycloak server domain (`auth-test.zerozerorobotics.com`) **will not be changed**.
    *   **Implication**: Third-party cookies will be blocked in Safari/Firefox (and Chrome soon).
    *   **Strategy**: The V2 implementation **must** include a "Hybrid Fallback" mechanism (Iframe check first -> Top-Level Redirect fallback if needed) to ensure cross-browser compatibility.

## Prerequisites
*   Access to Shopify Theme Code (Code Editor).
*   Access to Keycloak Admin Console (to update valid redirect URIs).

## Step 1: Create the Callback Page (Shopify)

We need a lightweight page to serve as the `redirect_uri` for the iframe. This page will receive the response from Keycloak and communicate it back to the parent window.

1.  **Create a new Liquid Page Template**: `page.session-check.liquid` (or use a specific Page resource).
2.  **Route**: Ensure it is accessible at `/pages/session-check` (or similar).
3.  **Content**:
    ```html
    {% layout none %}
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Session Check</title>
    </head>
    <body>
      <script>
        (function() {
          // 1. Parse Hash/Query for Result
          // Keycloak returns: #state=...&code=... (Success) OR #error=login_required (Failure)
          var hash = window.location.hash.substring(1);
          var params = new URLSearchParams(hash); // Or search search string if response_mode=query

          // Also check query params as fallback
          if (!params.has('code') && !params.has('error')) {
             params = new URLSearchParams(window.location.search);
          }
          
          var message = { type: 'KEYCLOAK_SESSION_STATUS' };

          if (params.has('error')) {
            message.status = 'inactive';
            message.error = params.get('error');
          } else if (params.has('code')) {
            message.status = 'active';
            message.code = params.get('code');
            // If we get a code, we might also get session_state, handle as needed
          } else {
             message.status = 'unknown';
          }

          // 2. Post Message to Parent
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(message, window.location.origin);
          }
        })();
      </script>
    </body>
    </html>
    ```

## Step 2: Update Keycloak Client Configuration

1.  Log in to Keycloak Admin.
2.  Navigate to the Client (`shopify-fake-store`).
3.  Add the new callback URL to **Valid Redirect URIs**:
    *   `https://store.hoverair.com/pages/session-check`
4.  Ensure **Web Origins** includes the store domain.
5.  Save.

## Step 3: Implement Silent Probe Logic (`session-sync-v2.liquid`)

Create a **new snippet** `snippets/session-sync-v2.liquid`. This file will contain the new iframe-based logic, including the Hybrid Fallback.

### Module Structure

1.  **Create File**: `snippets/session-sync-v2.liquid`
2.  **Implementation**:
    *   **Logic**: 
        1.  Attempt Silent Check (Iframe).
        2.  If `active` -> **Login**.
        3.  If `inactive` (login_required):
            *   Check `last_probe_at` timestamp.
            *   If `Date.now() - last_probe_at > COOLDOWN` (e.g., 2 mins), trigger **Top-Level Redirect** (Fallback) to catch blocked cookies (Safari).
            *   Else, stay anonymous.

    ```javascript
    // simplified pseudocode for v2
    function createProbeIframe() {
      // ... iframe creation ...
    }

    function dispatchTopLevelProbe() {
      // ... classic redirect logic ...
    }

    window.addEventListener('message', function(event) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== 'KEYCLOAK_SESSION_STATUS') return;

      if (event.data.status === 'active') {
         // Handle Login (Success!)
      } else {
         // Iframe says "User is anonymous" (or cookie blocked)
         // Check if we need to double-check via Top-Level Redirect
         if (shouldProbeTopLevel()) {
             dispatchTopLevelProbe(); // Fallback for Safari/Firefox
         } else {
             // Stay Anonymous, update cooldown
             updateProbeTimestamp();
         }
      }
    });
    ```

## Step 4: Integration & Testing

1.  **Modify `theme.liquid` (or `layout/theme.liquid`)**:
    *   Comment out the old include: `{% comment %} {% include 'session-sync' %} {% endcomment %}`
    *   Add the new include: `{% include 'session-sync-v2' %}`
2.  **Test Scenarios**:
    *   **Chrome/Edge (Default)**: Browse normally. Iframe should handle sync silently.
    *   **Safari/Firefox (Strict Privacy)**: 
        *   Log in at Keycloak.
        *   Navigate to Store.
        *   Expect: Iframe returns `login_required` (cookie blocked).
        *   Expect: Script triggers fallback Redirect (after cooldown).
        *   Result: User logged in after 1 redirect (vs. 0 for Chrome).

## Step 5: Production Rollout

1.  **Verify Hybrid Logic**: Ensure the fallback redirect doesn't cause loops (cooldown is critical).
2.  **Deployment**: Once V2 is verified across browsers, commit the changes to `theme.liquid`.
3.  **Cleanup**: Eventually deprecate and remove `session-sync.liquid` (V1).
