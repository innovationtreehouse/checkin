# Operating Model — context for gap analysis

Ground truth from the owner (2026-07-21). Anchors the top-down lenses used to find
meta-gaps against INDEX.md. Not a backlog file — a reference frame.

## Calendar (fiscal year ≠ program/membership year)
- **Fiscal year**: starts **Jul 1**
- **Program year + Membership year**: start **Sept 1**
- **Renewal opens**: ~**Jul 15**
- **Nonpayment tolerance / grace**: through ~**Sept 30**
- **Shopify early-pay discount**: if paid by **Aug 15**
- ⚠ The **Aug 15 discount ↔ Sept 1 year-start ↔ Sept 30 tolerance** overlap is a known
  reconciliation-pain window — origin of several financial-reconciliation PRs.

## Systems of record (source of truth per domain)
| Domain | Master | Notes |
|--------|--------|-------|
| Member identity | **Checkin** | authoritative |
| Attendance | **Checkin** | master as of ~2026-07; was ad-hoc spreadsheet |
| Inventory | **Checkin (future)** | today ad-hoc Google sheet; getting it in-system breaks single-person-expert dependency |
| Purchases / payment | **Shopify** | master of what was bought |
| Financials (ALL) | **QuickBooks** | everything lands here; master financial record |
| Corporate donations | **Benevity → QB** | point of origin; ends in QB |
| Background checks / sensitive PII | **Averity** | **NEVER imported** into checkin |
| Contracts | **Zoho** | |
| Comms / docs / lists / calendar | **Google** | email, drive, docs, groups, calendar |
| Infra | **AWS** | $dollars/day vs commercial $hundreds/month |

## Vocab
- **"Sponsored Program"** (policy term) = just **"Program"** — distinguishes from software/other. Outbound comms always say "program".

## Scope boundaries — OUT for this gap analysis (handled by humans, not SW)
- Grant conditions (exist, but out)
- Youth safety (mostly travel; this system can't handle it)
- Governance, insurance
- **Tripod / per-tool supervision / age-based shop-state** — system has no control point (doesn't lock the shop doors or tools), so tracking has no practical value. **NOTE: two-deep IS tracked — in scope** (facility-level adult coverage, has value even without door control)
- **Program Leader identifying Keyholders** — manual/human coordination
- **Code-of-conduct / SoC incidents** — reporting, investigation, discipline all handled outside the app
- **Shop Steward / tool maintenance work** — external role (app may show tool state, but the work is external)

## Mission / priority weighting (rank gaps by these)
1. **Inventory visibility** → break the single-person-expert (bus-factor) risk
2. **Toil reduction** (massive)
3. **QuickBooks automation** — enormous effort, required for sanity at scale
4. **Cost control** — custom-on-AWS ($/day) vs commercial SaaS ($hundreds/mo); the build-not-buy rationale
