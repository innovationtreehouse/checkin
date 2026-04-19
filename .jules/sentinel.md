## 2024-05-24 - [Timing Attack in Webhook Verification]
**Vulnerability:** Found a timing attack vulnerability in `src/app/api/webhooks/shopify/route.ts` where the HMAC signature from Shopify (`headerSignature`) was being compared to the expected signature (`generatedSignature`) using a standard string equality operator (`!==`).
**Learning:** Standard string comparisons fail early as soon as a mismatching character is found. This "fail-fast" behavior leaks timing information to an attacker, theoretically allowing them to guess the correct HMAC character by character and forge a valid Shopify webhook signature to bypass payment verification.
**Prevention:** Always use `crypto.timingSafeEqual()` when comparing security-sensitive signatures, hashes, or tokens. Both values must be converted to `Buffer` objects of the exact same length before comparison to ensure constant-time execution regardless of where the mismatch occurs.

## 2024-05-24 - React CSS Injection Vulnerability
**Vulnerability:** Used `dangerouslySetInnerHTML` to inject CSS dynamically in React components (`src/components/ContentWrapper.tsx`).
**Learning:** `dangerouslySetInnerHTML` can open up possibilities for XSS, even if it's currently injecting a static or semi-static string. It bypasses React's built-in escaping mechanisms. The project explicitly avoids using `dangerouslySetInnerHTML` for CSS injection in React components, favoring global CSS rules and class toggling on root elements like `body` (from memory).
**Prevention:** Avoid `dangerouslySetInnerHTML` unless absolutely necessary. Use CSS classes or inline styles with React's `style` prop instead. For global styles, toggle a class on a root element (like `body`) using a `useEffect` hook.

## 2024-05-24 - [Information Leakage in Error Responses]
**Vulnerability:** API endpoints were directly exposing `error.message` and `String(error)` in JSON responses sent to clients with a 500 status code.
**Learning:** Exposing raw error strings or stack traces can leak internal system details, database query structures, or execution contexts to end users or attackers. This violates the principle of failing securely and providing opaque errors to clients while retaining detail server-side.
**Prevention:** API route handlers should never return raw error details directly to the client. Instead, log the detailed error securely on the server (e.g., using `logBackendError`) and return a generic, sanitized error message (like 'Internal Server Error') to the client.
