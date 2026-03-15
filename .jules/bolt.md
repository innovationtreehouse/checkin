## 2024-05-18 - Understand where to place indices
**Learning:** Found an opportunity to improve query performance by adding a database index in Prisma.
**Action:** Adding indexing to frequently searched or queried fields could improve the read performance.

## 2026-03-15 - Date Allocation Loop Optimization
**Learning:** `new Date()` allocation inside loops over database records can cause high garbage collection pressure. Precomputing dates and passing them as reference arguments prevents N-date allocations per N-items.
**Action:** When calculating relative times on a set of records, hoist `new Date()` initialization outside of the loop.
