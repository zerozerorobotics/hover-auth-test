
const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>Session Check</title>
</head>
<body>
  <script>
    (function() {
      // Logic for session check callback - same as used in page.session-check.liquid
      // but running in a worker (or static file) context on a different domain.
      
      var message = { type: 'KEYCLOAK_SESSION_STATUS', status: 'unknown' };
      // Check hash first (implicit/OIDC flow often returns params in hash)
      var params = new URLSearchParams(window.location.hash.substring(1));
      
      // Fallback to query params if hash empty (for code flow)
      if (!params.has('code') && !params.has('error') && !params.has('session_state')) {
        params = new URLSearchParams(window.location.search);
      }

      if (params.has('code')) {
        message.status = 'active';
        message.code = params.get('code');
        message.session_state = params.get('session_state');
      } else if (params.has('error')) {
        message.status = 'inactive';
        message.error = params.get('error');
        message.error_description = params.get('error_description');
      }
      
      // Post message back to parent window
      // Use '*' targetOrigin because this worker might serve multiple store domains (us-test, central-test).
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
      }
    })();
  </script>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    return new Response(htmlContent, {
      headers: {
        "content-type": "text/html;charset=UTF-8",
        // Optional: Cache for performance
        "Cache-Control": "public, max-age=3600"
      },
    });
  },
};
