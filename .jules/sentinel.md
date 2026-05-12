## 2024-05-24 - [Timing Attack in Webhook Verification]
**Vulnerability:** Found a timing attack vulnerability in `src/app/api/webhooks/shopify/route.ts` where the HMAC signature from Shopify (`headerSignature`) was being compared to the expected signature (`generatedSignature`) using a standard string equality operator (`!==`).
**Learning:** Standard string comparisons fail early as soon as a mismatching character is found. This "fail-fast" behavior leaks timing information to an attacker, theoretically allowing them to guess the correct HMAC character by character and forge a valid Shopify webhook signature to bypass payment verification.
**Prevention:** Always use `crypto.timingSafeEqual()` when comparing security-sensitive signatures, hashes, or tokens. Both values must be converted to `Buffer` objects of the exact same length before comparison to ensure constant-time execution regardless of where the mismatch occurs.

## 2024-05-24 - React CSS Injection Vulnerability
**Vulnerability:** Used `dangerouslySetInnerHTML` to inject CSS dynamically in React components (`src/components/ContentWrapper.tsx`).
**Learning:** `dangerouslySetInnerHTML` can open up possibilities for XSS, even if it's currently injecting a static or semi-static string. It bypasses React's built-in escaping mechanisms. The project explicitly avoids using `dangerouslySetInnerHTML` for CSS injection in React components, favoring global CSS rules and class toggling on root elements like `body` (from memory).
**Prevention:** Avoid `dangerouslySetInnerHTML` unless absolutely necessary. Use CSS classes or inline styles with React's `style` prop instead. For global styles, toggle a class on a root element (like `body`) using a `useEffect` hook.

## 2024-05-24 - Dev Authentication Exposure in Production
**Vulnerability:** Developer authentication endpoints (`/api/auth/dev-personas`) and mock login providers were only protected by a feature flag (`NEXT_PUBLIC_DEV_AUTH`), which could theoretically leak or be enabled accidentally in production.
**Learning:** Checking only a feature flag can be dangerous for powerful development tools (like bypassing Google SSO to log in as an arbitrary SysAdmin). Feature flags can be misconfigured in CI/CD or intentionally toggled, whereas the `NODE_ENV` provides a hard guarantee of the runtime environment.
**Prevention:** Always pair development-only feature flags (like `NEXT_PUBLIC_DEV_AUTH`) with an explicit `process.env.NODE_ENV !== 'production'` check, especially when these features allow authentication bypass or privilege escalation.
