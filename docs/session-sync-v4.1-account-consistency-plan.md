# Session Sync V4.1: Cross-Tab Account Consistency (session_state)

## The Problem
When a user logs out and logs into a **different account** on Site A (e.g., `store.hoverair.com`), and then switches back to an already open tab for Site B (e.g., `central-test.zerozeroplatform.com`), Site B detects an `active` Keycloak session but fails to realize the underlying identity has changed. This results in the user browsing Site B as Account 1, while Keycloak actually considers them Account 2, leading to severe account desyncs and potential permission or checkout errors.

## The Solution
Leverage the OIDC `session_state` parameter to detect identity switches.
Instead of just asking Keycloak "Is *someone* logged in?", we ask "Is *someone* logged in, and is their session state still `ABC`?". 

This is achieved by storing the Keycloak `session_state` locally in Shopify's `localStorage` and continuously comparing it during our background `iframe` probes.

*Security Note: Adding `id_token` to the implicit/hybrid front-channel flow is discouraged by modern OIDC best practices due to exposure risks. Using `session_state` is the officially supported mechanism for cross-tab multi-RP session monitoring.*

---

## 1. Local Storage Management Strategy
We will use a new key: `keycloak_v4_session_state`.
Strict lifecycle management of this key is critical to avoid false positives (erroneous logouts) and infinite redirect loops.

*   **Initialization (Login)**: When the Iframe probe returns `status: 'active'` for the *first* time (or after an eager redirect), capture `event.data.session_state` and save it to `localStorage`.
*   **Verification (Multi-Tab Switch)**: When the Iframe probe fires (e.g., on `visibilitychange` making the tab active again), compare the incoming `event.data.session_state` with the stored local state.
    *   *If Mismatch*: The user switched accounts elsewhere. Immediately trigger a targeted logout on this current Shopify tab.
*   **Clearance (Logout/Eager Jump)**: 
    *   Whenever a user intentionally logs out of Shopify.
    *   Whenever our script forces a logout (due to Keycloak going `inactive` or a `session_state` mismatch).
    *   Whenever we fire a Phase 1 Eager Redirect (because we are about to grab a brand new state).
    *   **Action**: `localStorage.removeItem('keycloak_v4_session_state')` MUST be executed.

---

## 2. Implementation Steps

### A. Modify `snippets/session-sync-v2.liquid`

#### Step 1: Add Local Storage Helpers
```javascript
function getSessionState() {
  return localStorage.getItem('keycloak_v4_session_state');
}

function setSessionState(stateStr) {
  if (stateStr) {
    localStorage.setItem('keycloak_v4_session_state', stateStr);
  }
}

function clearSessionState() {
  localStorage.removeItem('keycloak_v4_session_state');
}
```

#### Step 2: Update Phase 1 Eager Redirect
Clear any stale state before we jump, ensuring when we come back, we start fresh.
```javascript
// Inside Phase 1 logic...
if (!STATE.isLoggedIn && getHintCookie() === '1' && (now - lastEagerProbe > EAGER_COOLDOWN)) {
  // ...
  sessionStorage.setItem('keycloak_v4_eager_ts', now);
  clearSessionState(); // <-- [NEW] CRITICAL CLEARANCE
  // ... window.location.href = probeUrl;
}
```

#### Step 3: Update Logout Sync Clearances
Ensure we wipe local state if Keycloak went dark or if we detect an anomaly.
```javascript
// ... under event.data.status !== 'active'
if (STATE.isLoggedIn) {
   console.log('[SessionSyncV4] Keycloak inactive. Syncing logout.');
   clearHintCookie();
   clearSessionState(); // <-- [NEW] CRITICAL CLEARANCE
   window.location.href = CONFIG.logoutUri + '?return_to=' + encodeURIComponent(window.location.pathname);
   return;
}
```

#### Step 4: The Core Logic - Compare `session_state`
Update the `status === 'active'` handler to perform the core consistency check.
```javascript
if (event.data.status === 'active') {
  setHintCookie(); // Refresh Hint
  
  var incomingState = event.data.session_state;
  var localState = getSessionState();

  if (!STATE.isLoggedIn) {
     // Scenario: User was anonymous, but Keycloak says active.
     // This is an Auto-Login trigger. We should save the new state.
     console.log('[SessionSyncV4] Active! Redirecting to login...');
     clearSessionState(); // clean slate before login
     /* 
       Note: We can't immediately setSessionState here because the page redirects 
       before Shopify natively establishes its session. 
       The NEXT time this script runs (when STATE.isLoggedIn === true), 
       localState will be empty, and it will capture it then.
     */
     window.location.href = CONFIG.loginRedirectUri + '?return_to=' + encodeURIComponent(window.location.pathname);
  } else {
     // Scenario: User is ALREADY logged in to Shopify. Keycloak is also Active.
     if (!localState) {
        // First background probe since the user logged in. Record the baseline baseline.
        if (incomingState) {
            console.log('[SessionSyncV4] Recording baseline session state.');
            setSessionState(incomingState);
        }
     } else if (incomingState && incomingState !== localState) {
        // [BOOM] ACCOUNT SWITCH DETECTED!
        console.warn('[SessionSyncV4] CRITICAL: Account mismatch detected. Forcing logout.');
        clearHintCookie();
        clearSessionState();
        // Force the current tab to log out. The sub-sequent reload will 
        // find them anonymous, detect the new active Keycloak session, and log them into the new account.
        window.location.href = CONFIG.logoutUri + '?return_to=' + encodeURIComponent(window.location.pathname);
     } else {
        // Normal. States match. Do nothing.
        // console.log('Session intact.');
     }
  }
}
```

### B. Verification of `workers/session-check.js`
Ensure the Cloudflare Worker extracts `session_state` from Keycloak's hash/query payload.
*Current code is correct:*
```javascript
if (params.has('code')) {
  message.status = 'active';
  message.code = params.get('code');
  message.session_state = params.get('session_state'); // This makes our entire V4.1 logic possible
}
```

---

## 3. Edge Cases Addressed

1.  **Browser Privacy (Safari / ITP)**: If third-party iframes are fully blocked, the probe returns `inactive`. The fallback eager top-level redirect (Phase 1) handles this. The `session_state` account-switch detection won't work silently under strict ITP, but the user will eventually be resynced upon manual refresh or navigation.
2.  **Concurrency (Rapid Tab Switching)**: Handled by the existing `iframeCooldownMs` (5 seconds). We do not read/write `session_state` chaotically.
3.  **Missing `session_state` Parameter**: Keycloak settings can vary. The logic `if (incomingState && incomingState !== localState)` ensures that if Keycloak fails to deliver a `session_state` for some reason, the code fails gracefully and does NOT trigger an infinite logout loop.
