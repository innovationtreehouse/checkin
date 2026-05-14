## 2024-05-24 - [Timing Attack in Webhook Verification]
**Vulnerability:** Found a timing attack vulnerability in `src/app/api/webhooks/shopify/route.ts` where the HMAC signature from Shopify (`headerSignature`) was being compared to the expected signature (`generatedSignature`) using a standard string equality operator (`!==`).
**Learning:** Standard string comparisons fail early as soon as a mismatching character is found. This "fail-fast" behavior leaks timing information to an attacker, theoretically allowing them to guess the correct HMAC character by character and forge a valid Shopify webhook signature to bypass payment verification.
**Prevention:** Always use `crypto.timingSafeEqual()` when comparing security-sensitive signatures, hashes, or tokens. Both values must be converted to `Buffer` objects of the exact same length before comparison to ensure constant-time execution regardless of where the mismatch occurs.

## 2024-05-24 - React CSS Injection Vulnerability
**Vulnerability:** Used `dangerouslySetInnerHTML` to inject CSS dynamically in React components (`src/components/ContentWrapper.tsx`).
**Learning:** `dangerouslySetInnerHTML` can open up possibilities for XSS, even if it's currently injecting a static or semi-static string. It bypasses React's built-in escaping mechanisms. The project explicitly avoids using `dangerouslySetInnerHTML` for CSS injection in React components, favoring global CSS rules and class toggling on root elements like `body` (from memory).
**Prevention:** Avoid `dangerouslySetInnerHTML` unless absolutely necessary. Use CSS classes or inline styles with React's `style` prop instead. For global styles, toggle a class on a root element (like `body`) using a `useEffect` hook.

## 2024-05-24 - Dev Auth Exposure in Production
**Vulnerability:** The application was using the feature flag `NEXT_PUBLIC_DEV_AUTH` to enable development-only personas and login mechanisms. If this flag were accidentally set to `true` in a production environment (e.g. through misconfiguration in Vercel), it would expose mock administrative users and allow unauthorized login without a password.
**Learning:** Development feature flags that bypass authentication or authorization are dangerous. They must never be trusted solely by their value in environment variables.
**Prevention:** Always pair development-only feature flags (like `NEXT_PUBLIC_DEV_AUTH`) with a strict environment assertion: `process.env.NODE_ENV !== 'production'`. This provides defense-in-depth, guaranteeing that even if a flag is misconfigured, the potentially dangerous feature cannot be enabled in the production build.
