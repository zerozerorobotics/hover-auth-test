# Auth Session Sync QA Guide

## Purpose

This guide helps QA verify the `auth-session-sync` Shopify snippet.

The snippet combines:

- Session Sync V4 behavior using the `KC_LOGGED_IN` hint cookie.
- Keycloak iframe session checks through `https://static.zerozeroplatform.com/session-check`.
- Google One Tap fallback for anonymous users without a reusable Keycloak session.

## What To Render

Use the new snippet:

```liquid
{% render 'auth-session-sync' %}
```

Do not render these at the same time on the same page:

```liquid
{% render 'session-sync-v2' %}
{% render 'gsi' %}
```

The old snippet name is only a wrapper:

```liquid
{% render 'customer-auth-orchestrator' %}
```

## Test Site

Primary test host:

```text
https://us-test.hoverair.com
```

Expected mapping:

```text
Keycloak base: https://auth-test.hoverair.com
Realm: vcopter
OIDC client: shopify-fake-store
Google One Tap target: us-test
```

## Enable Debug Logs

Open DevTools Console and run:

```js
localStorage.setItem('zz_auth_debug', 'true')
```

To disable:

```js
localStorage.removeItem('zz_auth_debug')
```

## Useful State Checks

Run this in DevTools Console:

```js
console.table({
  flow: sessionStorage.getItem('zz_auth_flow_state'),
  hintProbe: sessionStorage.getItem('zz_auth_hint_probe_status'),
  explicitLogout: sessionStorage.getItem('zz_auth_explicit_logout'),
  eagerAt: sessionStorage.getItem('keycloak_v4_eager_ts'),
  iframeAt: sessionStorage.getItem('keycloak_v4_iframe_last_probe'),
  sessionState: localStorage.getItem('keycloak_v4_session_state'),
  sid: localStorage.getItem('zz_session_id'),
  hasHint: document.cookie.includes('KC_LOGGED_IN=1')
})
```

## Clean Browser State

Before each scenario, use an incognito window where possible.

To clear local test state:

```js
sessionStorage.clear()
localStorage.removeItem('keycloak_v4_session_state')
localStorage.removeItem('zz_session_id')
document.cookie = 'KC_LOGGED_IN=; path=/; max-age=0'
```

If the cookie is set on the root domain, clear from DevTools Application tab as well.

## Network Requests To Watch

Open DevTools Network tab and watch for:

```text
/protocol/openid-connect/auth?...prompt=none
https://static.zerozeroplatform.com/session-check
/realms/vcopter/google-one-tap/init
/realms/vcopter/google-one-tap/login
/realms/vcopter/google-one-tap/launch
/customer_authentication/login
/account/logout
```

## Scenario A: Anonymous, No Keycloak Session, No Hint Cookie

Setup:

```js
sessionStorage.clear()
localStorage.removeItem('keycloak_v4_session_state')
localStorage.removeItem('zz_session_id')
document.cookie = 'KC_LOGGED_IN=; path=/; max-age=0'
```

Expected:

- No session-sync eager redirect.
- Google One Tap is shown or attempted.
- If user completes One Tap, browser calls `/google-one-tap/init`.
- Then browser calls `/google-one-tap/login`.
- Then browser navigates to `/google-one-tap/launch`.
- Session-sync must not redirect to `/customer_authentication/login` before GSI launch.

Pass if:

```text
GSI is the first login path when no Keycloak hint exists.
```

## Scenario B: Anonymous, Hint Cookie Present, Keycloak Inactive

Setup:

```js
document.cookie = 'KC_LOGGED_IN=1; path=/'
```

Make sure Keycloak is logged out in this browser.

Expected:

- Session-sync runs before GSI.
- Keycloak prompt=none or iframe check determines inactive.
- `KC_LOGGED_IN` is cleared.
- GSI can start only after stale hint is cleared.
- No redirect loop.

Pass if:

```text
Stale hint self-heals and GSI becomes available.
```

## Scenario C: Anonymous, Hint Cookie Present, Keycloak Active

Setup:

- Log in to Keycloak in this browser.
- Make Shopify customer anonymous.
- Ensure `KC_LOGGED_IN=1`.

Expected:

- GSI does not start.
- Session-sync has priority.
- Browser goes through Shopify `/customer_authentication/login`.
- Final page has Shopify customer logged in.

Pass if:

```text
Existing Keycloak session is reused without showing Google One Tap.
```

## Scenario D: Shopify Logged In, Keycloak Active

Expected:

- GSI does not start.
- Iframe check runs.
- No logout.
- `KC_LOGGED_IN=1` is set or preserved.
- `keycloak_v4_session_state` is set if missing.

Pass if:

```text
Logged-in customer remains logged in and no One Tap appears.
```

## Scenario E: Shopify Logged In, Keycloak Inactive

Setup:

- Shopify customer is logged in.
- Keycloak session is logged out or expired.

Expected:

- Iframe check reports inactive.
- `KC_LOGGED_IN` is cleared.
- `keycloak_v4_session_state` is cleared.
- Browser redirects to `/account/logout?return_to=...`.
- GSI does not start.

Pass if:

```text
Shopify logout sync follows Keycloak logout.
```

## Scenario F: Account Mismatch

Setup:

- Shopify customer is logged in.
- `localStorage.keycloak_v4_session_state` contains an old session state.
- Keycloak iframe check returns a different `session_state`.

Expected:

- Mismatch is detected.
- User is sent to `/account/logout?return_to=...`.
- GSI does not start.

Pass if:

```text
Different Keycloak account forces Shopify logout/resync.
```

## Scenario G: GSI Running While Session Check Returns Active

Setup:

- Anonymous user.
- No `KC_LOGGED_IN`.
- Start GSI and slow down network in DevTools.
- Let an iframe/session result arrive while GSI is running.

Expected:

- Session-sync does not overwrite GSI handoff.
- Browser continues to `/google-one-tap/launch`.
- `zz_auth_flow_state` reaches `gsi_handoff`.

Pass if:

```text
Only GSI controls navigation while GSI handoff is active.
```

## Scenario H: Logout Pages

Paths:

```text
/account/logout
/customer_authentication/logout
```

Expected:

- Explicit logout state is set.
- `KC_LOGGED_IN` is cleared.
- `keycloak_v4_session_state` is cleared.
- No GSI.
- No session-sync eager redirect.

Pass if:

```text
Automatic login is suppressed after explicit logout.
```

## Scenario I: Shopify Customer Authentication Page

Path:

```text
/customer_authentication/login
```

Expected:

- No GSI.
- No eager probe.
- Shopify session creation is not interrupted.

Pass if:

```text
The auth page is left alone.
```

## Scenario J: Session Sync Bounce Page

Path shape:

```text
/pages/session-sync?target=/some/path#sid=...
```

Expected:

- `sid` is saved to `localStorage.zz_session_id`.
- `KC_LOGGED_IN=1` is set.
- Browser redirects to the relative target.
- GSI does not start on the bounce page.

Pass if:

```text
Bounce page stores session marker and returns to target.
```

## Scenario K: Hover App WebView

Setup:

Use a user-agent containing:

```text
Hover
Hover X1
```

Expected:

- Orchestrator exits.
- No GSI.
- No iframe probe.
- No session-sync redirect.

Pass if:

```text
The app WebView is not affected.
```

## Final QA Sign-Off

Mark pass only when:

- Existing Keycloak sessions are reused before GSI.
- Google One Tap appears only as fallback.
- Shopify logged-in users never see One Tap.
- Keycloak logout logs out Shopify.
- Session-state mismatch forces logout/resync.
- Logout/auth/session-sync pages are not interrupted.
- GSI handoff is not overridden by iframe or eager session-sync redirects.

## Known Items To Confirm

- Confirm Cloudflare Worker posts messages from `https://static.zerozeroplatform.com`.
- Confirm Shopify preserves `return_to` for `/customer_authentication/login`.
- Confirm Google One Tap behavior in browsers with third-party cookie restrictions.
