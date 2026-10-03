# Exact locator coordinate hardening — deployment pending

## Reason for the change

Checkpoint 04F.1 compares the complete reconstructed locator before returning
a passage. Review of migration 017 found that database acceptance compared
document/text/anchor fingerprints but did not independently compare every
coordinate represented by those fingerprints. A caller could copy a valid
fingerprint alongside a changed byte interval, paragraph index or PDF geometry.

Migration 018 closes that database gap. It reconstructs the complete expected
target from the accepted normalization record and compares JSON values for
equality before a verification record is inserted or updated. Because locator
insertion and verification acceptance use one transaction, guard failure also
rolls back the new locator.

## Implemented

- Exact web target comparison includes byte start/end, paragraph index,
  heading-path fingerprints, block identity and text/range fingerprints.
- Exact PDF target comparison includes the full anchor (page object, text-item
  interval, geometry and fingerprints), page structure and snapshot identity.
- Fabricated PDF printed-page labels and section/heading metadata are rejected;
  the current parser does not independently resolve those fields.
- Existing verified records are checked before migration commit. Invalid old
  records cause deployment to abort for review rather than silently passing.
- The guard applies to both insert and update, and its helper functions are
  unavailable to anonymous/authenticated clients.
- The predeploy database lifecycle adds nine tampering attempts while preserving
  copied hashes, plus unchanged valid acceptance and passage preparation.
- The deployment script checks the exact 001–017 baseline, holds the migration
  lock, refuses active research jobs, validates trigger installation and client
  denial, then records version 018 in the same transaction.

## Verification status

Local TypeScript, lint, all 478 active tests and the production build pass.
The migration's live predeploy test has **not passed**: database connections
timed out before SQL execution. DNS resolved and TCP reached the configured
session pooler. A direct `pg` connection probe also timed out. This does not
establish whether the cause is project availability, pooler health/capacity,
network policy or configuration.

Migration 018 is **not deployed**. The last confirmed installed schema remains
001–017. The earlier installed-database passage lifecycle passed before this
connection failure. Do not present that earlier success as verification of 018.

## Resume

When database connectivity is restored:

1. Run `npm run test:migration:018:predeploy` against deployed 001–017.
2. Review failures and fix them before deployment.
3. Run `npm run db:migrate:018` only after predeploy success.
4. Run `npm run test:integration:coordinates` against installed 018.
5. Update this status and the installed-schema references after success.

Then continue 04F.2: durable evidence decisions and semantic review. No new
source adapter, model call or public research route is enabled by this guard.
