## 2024-05-24 - [Timing Attack in Webhook Verification]
**Vulnerability:** Found a timing attack vulnerability in `src/app/api/webhooks/shopify/route.ts` where the HMAC signature from Shopify (`headerSignature`) was being compared to the expected signature (`generatedSignature`) using a standard string equality operator (`!==`).
**Learning:** Standard string comparisons fail early as soon as a mismatching character is found. This "fail-fast" behavior leaks timing information to an attacker, theoretically allowing them to guess the correct HMAC character by character and forge a valid Shopify webhook signature to bypass payment verification.
**Prevention:** Always use `crypto.timingSafeEqual()` when comparing security-sensitive signatures, hashes, or tokens. Both values must be converted to `Buffer` objects of the exact same length before comparison to ensure constant-time execution regardless of where the mismatch occurs.

## 2024-05-24 - React CSS Injection Vulnerability
**Vulnerability:** Used `dangerouslySetInnerHTML` to inject CSS dynamically in React components (`src/components/ContentWrapper.tsx`).
**Learning:** `dangerouslySetInnerHTML` can open up possibilities for XSS, even if it's currently injecting a static or semi-static string. It bypasses React's built-in escaping mechanisms. The project explicitly avoids using `dangerouslySetInnerHTML` for CSS injection in React components, favoring global CSS rules and class toggling on root elements like `body` (from memory).
**Prevention:** Avoid `dangerouslySetInnerHTML` unless absolutely necessary. Use CSS classes or inline styles with React's `style` prop instead. For global styles, toggle a class on a root element (like `body`) using a `useEffect` hook.

## 2024-05-24 - Missing Environment Checks for Development Authentication
**Vulnerability:** Development mock authentication features (like `CredentialsProvider` and `DevLoginPicker`) were gated solely by a feature flag (`NEXT_PUBLIC_DEV_AUTH`) without checking the `NODE_ENV`. If the feature flag is accidentally enabled in a production environment, it allows full authentication bypass and unauthorized access to any account (including Sysadmins).
**Learning:** Relying purely on application-level feature flags for inherently insecure or debug features is dangerous because environment variables can be easily misconfigured or accidentally leaked across environments during deployment.
**Prevention:** Always hard-block development-only and insecure features from running in production by explicitly adding a `process.env.NODE_ENV !== 'production'` check alongside any custom feature toggles to provide defense in depth against configuration mistakes.
