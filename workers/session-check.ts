// @ts-nocheck
/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/session-check') {
			const html = `<!DOCTYPE html>
<html>
<head>
  <title>Session Check</title>
</head>
<body>
  <script>
    (function() {
      var message = { type: 'KEYCLOAK_SESSION_STATUS', status: 'unknown' };
      var params = new URLSearchParams(window.location.hash.substring(1)); // OIDC often uses hash
      
      // Fallback to query params if hash is empty (for some response_types)
      if (!params.has('code') && !params.has('error') && !params.has('session_state')) {
        params = new URLSearchParams(window.location.search);
      }

      if (params.has('code')) {
        message.status = 'active';
        message.code = params.get('code');
        message.session_state = params.get('session_state');

        // Parse the OIDC id_token if provided via Hybrid flow
        var idToken = params.get('id_token');
        if (idToken) {
           try {
              // JWT structure is header.payload.signature
              var payloadBase64 = idToken.split('.')[1];
              // Decrypt Base64Url to string
              var decodedPayload = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
              var payloadInfo = JSON.parse(decodedPayload);
              // 'sub' is the standard OIDC identifier for the User ID
              message.userId = payloadInfo.sub;
           } catch(e) {
              console.error("[Session Check] failed to parse id_token", e);
           }
        }

      } else if (params.has('error')) {
        message.status = 'inactive';
        message.error = params.get('error');
        message.error_description = params.get('error_description');
      } else if (params.has('session_state')) {
         // Implicit check might just return session_state without code if prompt=none and user logged in but response_type=none? 
         // But usually response_type=code returns code.
         // If we are here, something is weird or prompt=none verified session but we didn't ask for code?
         // For now, assume if no code/error, it might be unknown.
      }

      // Send back to parent (Store)
      // We use '*' as targetOrigin because this static file might be used by multiple store domains (us-test, central-test).
      // The Parent (Store) is responsible for verifying the event.origin (cdn.shopify.com) if strict security is needed.
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
      }
    })();
  </script>
</body>
</html>`;

			return new Response(html, {
				headers: {
					'Content-Type': 'text/html; charset=utf-8',
				},
			});
		}

		return new Response('Hello World!');
	},
} satisfies ExportedHandler<Env>;
