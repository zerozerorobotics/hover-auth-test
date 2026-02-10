# Session Sync Constraints & Limitations

This document outlines the constraints and limitations of the current `session-sync.liquid` implementation.

## 1. Probe Cooldown Period (2 Minutes)

*   **Constraint**: The `shouldProbe()` function enforces a 2-minute cooldown between Keycloak session checks for anonymous users.
    *   `PROBE_COOLDOWN_MS = 2 * 60 * 1000` (120,000 ms).
*   **Mechanism**: A timestamp `keycloak_last_probe_at` is stored in `sessionStorage` after each probe. Subsequent checks verify if `Date.now() - lastProbeAt >= PROBE_COOLDOWN_MS`.
*   **Impact**:
    *   **Delayed Sync**: If a user logs in on Site A, and then switches back to Site B (where they are anonymous) within 2 minutes of the last check, Site B will **not** immediately detect the login state. The user must wait for the cooldown to expire or manually refresh the page after the cooldown.
    *   **User Experience**: This can lead to a disjointed experience where a user expects to be logged in across all sites immediately but encounters a delay on some sites.

## 2. Top-Level Redirect for Probing

*   **Constraint**: The current implementation uses `window.location.href` to redirect the browser to Keycloak for the session check.
    *   `dispatchProbe()` sets `window.location.href = probeUrl`.
*   **Impact**:
    *   **Page Reload**: Even with `prompt=none`, the browser navigates away from the current page to Keycloak and then bounces back. This causes a full page reload.
    *   **Interruption**: If a user is reading content or performing an action (e.g., filling a form) when the probe triggers (e.g., on tab focus), their context is lost due to the reload.
    *   **Visual Glitch**: The user sees the URL bar change and the page refresh, which can be jarring.

## 3. Session Storage Dependencies

*   **Constraint**: The logic relies heavily on `sessionStorage` for state management (`keycloak_checked`, `explicit_logout`, `keycloak_last_probe_at`).
*   **Impact**:
    *   **Tab Isolation**: `sessionStorage` is unique to each tab/window. A probe in one tab does not update the state in another tab. Each tab manages its own cooldown timer.
    *   **Logout Persistence**: The `explicit_logout` flag is session-scoped. If a user closes the tab and reopens it, the flag is lost, and the script may attempt to auto-login again if a valid Keycloak session exists (which might be desired behavior, but worth noting).

## 4. Requirement for User Interaction (Visibility Change)

*   **Constraint**: The `dispatchProbe()` function is primarily triggered by the `visibilitychange` event (when the tab becomes visible/focused).
*   **Impact**:
    *   **Background Tabs**: If a user has multiple tabs open (Site A, Site B, Site C) and logs in on Site A, Sites B and C will **not** update their state until the user actively clicks on their respective tabs.
    *   **Passive Sync**: There is no background polling or cross-tab communication (e.g., via `BroadcastChannel` or `localStorage` events) to trigger sync in background tabs.

## 5. Security & Token Handling

*   **Constraint**: The script relies on URL parameters (Query or Hash) to receive the Session ID (`sid`) from Keycloak.
*   **Impact**:
    *   **Exposure Risk**: While Hash (`#sid=`) is safer, the code maintains a fallback to Query Parameters (`?sid=`), which could expose the Session ID in browser history or server logs if not configured correctly on the Keycloak side.
    *   **Client-Side Only**: The session validation and token storage happen entirely on the client-side (`localStorage`).

## Summary of Critical Timings

| Parameter | Value | Description |
| :--- | :--- | :--- |
| `PROBE_COOLDOWN_MS` | 120,000 ms (2 min) | Minimum time between automated session checks for anonymous users. |

## 6. Necessity of Cooldown Mechanism

The 2-minute cooldown is not arbitrary; it is a critical safeguard required by the current implementation strategy (Top-Level Redirect).

### Why is it necessary?

1.  **Prevention of Infinite Redirect Loops (The "Loop of Death")**
    *   **Scenario without cooldown**:
        1.  User opens Site A (Anonymous).
        2.  Script redirects to Keycloak to check session.
        3.  Keycloak sees no session -> Redirects back to Site A.
        4.  Site A loads -> Script sees user is Anonymous -> Redirects to Keycloak again.
        5.  **Result**: Infinite loop, rendering the site unusable.
    *   **Role of Cooldown**: The `keycloak_checked` flag and timestamp act as a "circuit breaker," ensuring that after a failed check, the script backs off and allows the user to browse.

2.  **Mitigation of UX Disruption**
    *   Since the check uses a **Full Page Redirect** (`window.location.href`), every check interrupts the user's flow.
    *   Without a significant cooldown (e.g., 2 minutes), if a user switches tabs frequently, they would be constantly redirected, making the site frustrating to use.

3.  **Server Load Protection**
    *   Prevents a single client from spamming the Keycloak server with authentication requests on every tab focus event (`visibilitychange`).

### Optimization Potential

If the implementation were switched to a hidden `<iframe>` based check:
*   **UX Impact**: The disruption would be eliminated (silent check).







