# Keycloak Filter Deprecation Analysis

## Executive Summary

It is recommended to **DEPRECATE** and remove the `ShopifyRedirectFilter.java` entirely.

Current V4 Session Sync implementation (Iframe/Worker) supersedes the filter's functionality and conflicts with some of its logic.

---

## Detailed Component Analysis

### Scenario 1: Auto-Login Probe (`state=PROBE`)
- **Filter Logic**: Intercepts `state=PROBE` redirects. If successful (`code`), manually constructs a Shopify login URL. If failed (`error`), redirects to home.
- **V4 Conflict**:
  - V4's Eager Redirect explicitly relies on standard OIDC behavior: receive `code` or `error` at the `redirect_uri` (current page).
  - The Filter intercepts this and forces a redirect to `/account/login` or Home, **breaking the V4 flow** which expects to handle the result via Shopify App or Iframe.
- **Recommendation**: **MUST REMOVE**. The filter actively interferes with V4.

### Scenario 2: Error & Replay Recovery
- **Filter Logic**: Detects "Back button" replays or `invalid_grant` errors and redirects to a safe URL instead of showing a raw Keycloak error page.
- **V4 Impact**: None. This is a general UX improvement.
- **Recommendation**: **Loss Acceptable**. While good to have, it is not critical for session sync. If desired, this specific logic can be extracted into a standalone, lightweight filter later, but the current complex filter should go.

### Scenario 3: History Cleanup (Bounce Page)
- **Filter Logic**: Rewrites 302 redirects to point to `/pages/session-sync` (Bounce Page) to inject `sid` and clean browser history.
- **V4 Impact**:
  - V4 uses Iframe Check for session monitoring, eliminating the need for `sid` injection via Bounce Page.
  - V4 handles its own history/state management.
- **Recommendation**: **OBSOLETE**. No longer needed.

---

## Conclusion

The `ShopifyRedirectFilter` was designed for the V1/V2 architecture which relied heavily on server-side intercepts and Bounce Pages. V4 moves this logic to the client-side (Shopify Theme JS + Cloudflare Worker).

**Action Plan:**
1. Disable/Remove `ShopifyRedirectFilter` from Keycloak deployment.
2. Rely entirely on V4 Session Sync logic.
