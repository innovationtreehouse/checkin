import { allRoutes, allOutbounds, type Token } from "../src/security/core";
import "../src/security/registry";

function hasPii(tokens: readonly Token[]): boolean {
  return tokens.some((t) => t.endsWith(":pii"));
}

const routes = Array.from(allRoutes()).map(([, spec]) => spec);
const outbounds = Array.from(allOutbounds()).map(([, spec]) => spec);

let routesExposingPii = 0;
let routesAdminOnly = 0;
let routesSelfOnly = 0;
let routesHouseholdOrProgram = 0;
let routesKeyholderVisitor = 0;
let routesNoPiiAtAll = 0;
let dangerouslyAllow = 0;

const breakdown: Record<string, string[]> = {
  "admin-only PII": [],
  "self-only PII": [],
  "household/program PII": [],
  "keyholder visitor PII": [],
  "no PII (or empty view)": [],
  "dangerously_allow (stripper bypassed)": [],
};

for (const r of routes) {
  if (r.dangerously_allow_all_data_access) {
    dangerouslyAllow++;
    breakdown["dangerously_allow (stripper bypassed)"].push(r.endpoint);
    continue;
  }
  const allTokens = r.orderedView.flatMap(([, t]) => t);
  if (!hasPii(allTokens)) {
    routesNoPiiAtAll++;
    breakdown["no PII (or empty view)"].push(r.endpoint);
    continue;
  }
  routesExposingPii++;
  const nonAdminViews = r.orderedView.filter(
    ([role]) => role !== "sysadmin" && role !== "boardMember"
  );
  const nonAdminPiiTokens = nonAdminViews
    .flatMap(([, t]) => t)
    .filter((t) => t.endsWith(":pii"));

  if (nonAdminPiiTokens.length === 0) {
    routesAdminOnly++;
    breakdown["admin-only PII"].push(r.endpoint);
    continue;
  }
  const hasKeyholderVisitor = nonAdminPiiTokens.some((t) =>
    t.startsWith("all_current_visitors:")
  );
  const hasHouseholdOrProgram = nonAdminPiiTokens.some(
    (t) => t.startsWith("their_households:") || t.startsWith("their_program_participants:")
  );
  const hasSelfPii = nonAdminPiiTokens.some((t) => t.startsWith("their_own:"));
  if (hasHouseholdOrProgram) {
    routesHouseholdOrProgram++;
    breakdown["household/program PII"].push(r.endpoint);
  } else if (hasKeyholderVisitor) {
    routesKeyholderVisitor++;
    breakdown["keyholder visitor PII"].push(r.endpoint);
  } else if (hasSelfPii) {
    routesSelfOnly++;
    breakdown["self-only PII"].push(r.endpoint);
  }
}

let outboundsWithPii = 0;
const outboundsList: string[] = [];
for (const o of outbounds) {
  if (o.tiers.includes("pii")) {
    outboundsWithPii++;
    outboundsList.push(`${o.surface} (tiers: ${JSON.stringify(o.tiers)})`);
  }
}

console.log("\n=== PII exposure audit ===\n");
console.log(`Total routes registered:                 ${routes.length}`);
console.log(`Routes with dangerously_allow (bypass):  ${dangerouslyAllow}`);
console.log(`Routes with empty view / no PII grant:   ${routesNoPiiAtAll}`);
console.log(`Routes that surface PII (stripper-gated):${routesExposingPii}`);
console.log(`  └─ admin-only (sysadmin/board only):   ${routesAdminOnly}`);
console.log(`  └─ self-only (their_own:pii):          ${routesSelfOnly}`);
console.log(`  └─ household/program scope PII:        ${routesHouseholdOrProgram}`);
console.log(`  └─ keyholder visitor-PII:              ${routesKeyholderVisitor}`);
console.log("\n--- Breakdown ---");
for (const [k, v] of Object.entries(breakdown)) {
  if (v.length === 0) continue;
  console.log(`\n${k} (${v.length}):`);
  v.forEach((e) => console.log(`  - ${e}`));
}
console.log(`\n--- Outbounds carrying PII (${outboundsWithPii} of ${outbounds.length}) ---`);
outboundsList.forEach((s) => console.log(`  - ${s}`));
