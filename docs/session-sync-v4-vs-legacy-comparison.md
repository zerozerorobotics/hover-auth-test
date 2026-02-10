# Session Sync: V4 Hybrid vs. V1/V2 Legacy Architecture

## Executive Summary

The transition from `session-sync.liquid` (V1/V2) to `session-sync-v2.liquid` (V4) represents a fundamental shift from a "server-side intercept" model to a "client-side orchestration" model. The new architecture is cleaner, more robust, and strictly adheres to modern Web security standards.

---

## 1. Architectural Philosophy: From "Intercept" to "Probe"

| Feature | Legacy V1/V2 (`session-sync.liquid`) | New V4 (`session-sync-v2.liquid`) |
| :--- | :--- | :--- |
| **Control Point** | **Server-side (Java Filter)**. Keycloak intercepts 302s to inject logic. | **Client-side (Shopify Theme JS)**. Frontend orchestrates the flow. |
| **Logic Flow** | Interrupts standard OIDC with a "Bounce Page" (`/pages/session-sync`). | Follows standard OIDC `prompt=none` flow. |
| **Inter-module Coupling** | High. Liquid logic depends on specific Java Filter behavior. | Low. Liquid logic depends on standard OIDC protocol results. |

**Key Benefit**: V4 minimizes "magic" happening in the infrastructure layer (Keycloak Filter), making the system easier to debug and maintain.

---

## 2. State Management: The "Hint Cookie" Strategy

V4 replaces the complex `sid` / `zz_session_id` tracking with a high-level **Hint Cookie**.

*   **Legacy (sid)**: Attempted to pass a HMAC-signed Session ID through URL fragments and Bounce Pages. This was brittle, often stripped by browsers/Shopify, and difficult to sync across subdomains.
*   **V4 (`KC_LOGGED_IN`)**: A simple boolean-like cookie set on `.zerozeroplatform.com`. It doesn't contain sensitive data; it merely signals "Keycloak might have a session."

**Key Benefit**: Dramatic reduction in state management complexity. We only "probe" deep (Iframe) when the "hint" tells us it's worthwhile.

---

## 3. Logical Structure: Defined Phases

V4 (V2 code) organizes logic into three non-overlapping phases:

1.  **Phase 0 (Login)**: Writes the Hint Cookie.
2.  **Phase 1 (Eager Redirect)**: High-speed, top-level sync if a Hint exists but the user is anonymous. Uses standard `window.location`.
3.  **Phase 2 (Iframe Check)**: Background, silent monitoring. Handles **Logout Sync** and self-heals stale Hint Cookies.

**Legacy Comparison**: V1/V2 logic was often "monolithic," attempting to handle detection, redirection, and state-sync in a single coupled loop, leading to edge-case bugs and "Action Expired" errors.

---

## 4. Security & Decoupling: Cloudflare Worker

V4 introduces a dedicated **Cloudflare Worker** (`static.zerozeroplatform.com/session-check`) to solve the "Iframe Barrier."

*   **Problem**: Browsers block reading Keycloak results in an Iframe due to `X-Frame-Options` and SameSite cookies.
*   **V4 Solution**: Keycloak redirects to the Worker. The Worker parses the `code` or `error` and uses `postMessage` to send it securely to the parent.
*   **Legacy Solution**: Relied on the Java Filter to "wrap" regular pages in a way that JS could potentially read, which was hacky and bypassed too many security defaults.

---

## 5. Maintenance & Observability

Why V4 feels "Cleaner":
- **Linear Code**: JS follows a straight path (Phase 1 -> Phase 2).
- **Standardized**: Uses standard OIDC `prompt=none` and `response_type=code`.
- **Self-Healing**: If a probe says "inactive" but a Hint Cookie exists, it is automatically cleared.
- **Observability**: Clear console logs and discrete `sessionStorage` cooldowns for each phase.

---

## Conclusion

`session-sync-v2.liquid` is not just "shorter" or "prettier"; it is an **architectural upgrade**. By moving away from server-side intercepts and hardcoded Session IDs, we've created a system that is resilient to browser policy changes (like ITP) and easier for any developer to understand using standard OIDC knowledge.
