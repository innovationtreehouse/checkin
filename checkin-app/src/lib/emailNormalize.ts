/**
 * Canonicalize an email to a stable, provider-aware key so address variants that
 * deliver to the same inbox collapse together. Conservative on purpose — over-
 * normalizing would merge distinct real addresses.
 *
 *  - lowercase + trim
 *  - strip the plus-tag from the local part (broadly honored, safe everywhere)
 *  - Gmail only: drop all dots and treat googlemail.com as gmail.com
 *
 * `Foo.Bar+sale@GoogleMail.com` and `foobar@gmail.com` → same key;
 * `foo.bar@outlook.com` stays distinct from `foobar@outlook.com`.
 *
 * Zero imports on purpose: this is the shared, neutral email-dedupe rule (used by
 * abuse rate-limiting and volunteer-designation matching), so it must not pull in
 * any subsystem or risk an import cycle.
 */
export function canonicalizeEmail(email: string): string {
    const trimmed = email.trim().toLowerCase();
    const at = trimmed.lastIndexOf("@");
    if (at < 0) return trimmed; // not an address shape — key as-is

    let local = trimmed.slice(0, at);
    let domain = trimmed.slice(at + 1);

    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);

    if (domain === "googlemail.com") domain = "gmail.com";
    if (domain === "gmail.com") local = local.replace(/\./g, "");

    return `${local}@${domain}`;
}
