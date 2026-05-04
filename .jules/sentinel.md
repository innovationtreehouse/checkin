## 2024-05-24 - [Timing Attack in Webhook Verification]
**Vulnerability:** Found a timing attack vulnerability in `src/app/api/webhooks/shopify/route.ts` where the HMAC signature from Shopify (`headerSignature`) was being compared to the expected signature (`generatedSignature`) using a standard string equality operator (`!==`).
**Learning:** Standard string comparisons fail early as soon as a mismatching character is found. This "fail-fast" behavior leaks timing information to an attacker, theoretically allowing them to guess the correct HMAC character by character and forge a valid Shopify webhook signature to bypass payment verification.
**Prevention:** Always use `crypto.timingSafeEqual()` when comparing security-sensitive signatures, hashes, or tokens. Both values must be converted to `Buffer` objects of the exact same length before comparison to ensure constant-time execution regardless of where the mismatch occurs.

## 2024-05-24 - React CSS Injection Vulnerability
**Vulnerability:** Used `dangerouslySetInnerHTML` to inject CSS dynamically in React components (`src/components/ContentWrapper.tsx`).
**Learning:** `dangerouslySetInnerHTML` can open up possibilities for XSS, even if it's currently injecting a static or semi-static string. It bypasses React's built-in escaping mechanisms. The project explicitly avoids using `dangerouslySetInnerHTML` for CSS injection in React components, favoring global CSS rules and class toggling on root elements like `body` (from memory).
**Prevention:** Avoid `dangerouslySetInnerHTML` unless absolutely necessary. Use CSS classes or inline styles with React's `style` prop instead. For global styles, toggle a class on a root element (like `body`) using a `useEffect` hook.

## 2024-05-24 - Development Backdoor Exposure via NEXT_PUBLIC_
**Vulnerability:** The `DevLoginPicker` component and its associated mock authentication endpoint (`/api/auth/dev-personas`) relied solely on the `NEXT_PUBLIC_DEV_AUTH` environment variable to determine if they should be enabled.
**Learning:** `NEXT_PUBLIC_` environment variables are embedded directly into the frontend bundle at build time. Relying purely on this variable to hide development authentication backdoors exposes the system to a critical risk if this variable is mistakenly set or leaked in production.
**Prevention:** Development-only mock authentication features must include a strict server-side `process.env.NODE_ENV !== 'production'` check to guarantee they are entirely disabled in a production environment, regardless of other configuration settings.
