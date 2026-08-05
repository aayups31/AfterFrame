# Codex Phase 3 — Evidence Pipeline

Implement source normalization, exact locator records, evidence extraction, claim records, and verification passes.

Requirements:

- source and locator are separate records;
- source independence groups;
- verified / approximate / stale / unavailable locator states;
- book locators require edition identity for exact page claims;
- article locators use heading path and text fingerprint;
- video locators store start and end timestamps;
- each exploration beat references evidence and claim IDs;
- no confidence percentages;
- evaluator catches unsupported claims and quote mismatch;
- source-opening endpoint resolves a fresh target.

Use curated fixtures first. Do not scrape or reproduce copyrighted books or unauthorized transcripts.
