# Map and admin supervision

## Running the application

Keep the existing backend (port 4000) and Vite frontend (port 5173) running. Sign in with an existing account. The **Heatmap** tab displays genuine locally saved inspections, while **Admin** displays inspections acknowledged by the central server.

A server-verified ADMIN account sees the Admin tab. Registration always creates an INSPECTOR. To grant an additional existing account administrative access, an authorized operator can run in `apps/backend`:

```
npm run admin:grant -- EXISTING_USERNAME
```

Sign out and sign back in after changing roles. The API checks current database roles, rather than trusting the role stored in the browser or an old token. No new admin credentials are created by this change.

## Database setup

Use the backend's configured DATABASE_URL and JWT_SECRET. Do not put either secret in frontend environment variables.

```
npm run setup:supervision
```

The migration adds `inspection_events`, `inspection_evidence`, `inspection_reviews`, and an append function. Earlier `inspections` records are preserved and are available as an explicitly unverified earlier-record list in the admin dashboard. Re-running the migration preserves existing data.

For an integration check that rolls back all test records:

```
npx tsx scripts/verify-supervision.ts
```

## Inspection synchronization

Every completed audit is saved locally with an immutable outbox snapshot in the same IndexedDB transaction. The snapshot contains the inspection, correction reason, original photograph blobs, owner username and a unique event identifier. Corrections create additional events for the same inspection. Genuine earlier local records belonging to the signed-in inspector are queued once on upgrade.

The scanner shows pending submissions, sending state and upload errors. It retries every ten seconds and on reconnection. A valid signed-in session is required. Reopening the installed app offline retains the profile and queue; sign in again when connected if its session token is absent or expired. Queues are separated by username. Removing a local history entry leaves queued evidence intact; it does not remove the central copy.

The backend checks original image bytes against the SHA-256 manifest, computes the score from submitted rule statuses, and binds identity to the authenticated database account. Repeated requests with the same event ID return the same acknowledgement. Changed data cannot reuse that ID, and a different account cannot revise the inspection.

## Admin workflow

The central feed refreshes every five seconds and shows the last successful refresh, capture time, server receipt time, inspector, score, location, revisions and review flags. Network failures leave earlier loaded data visible with a stale-data warning. The feed shows the latest 500 inspections; the earlier unverified list shows up to 100 records.

Select an inspection to see every revision, rule results, correction reasons, ledger hashes and original photographs. Photographs are downloaded through an authenticated admin endpoint and verified again in the browser before display. Notes and REVIEWED/ESCALATED decisions are appended to the selected revision. A new revision requires its own review.

Flags identify missing/imprecise location, missing originals, manual declarations, identity mismatch, delayed synchronization, future timestamps, unexplained corrections, changed failed checks and removed photographs. They are review signals, not proof of bribery.

## Heatmap behavior

The map is always rendered, even with no coordinates. Only valid, recorded coordinates become markers. Missing-location inspections are listed separately. Green markers mean every rule passed; amber means a warning needs review; red means a check failed. The optional heat layer overlays actual warning/failure locations, with stronger intensity where they overlap. It measures recorded findings, not misconduct or geographic prevalence.

The map fits all recorded coordinates and handles container resizing. Without background tiles, markers and heat overlays still render, but the basemap may be blank. Basemap tiles require network access and are not fully cached for offline use.

Phone geolocation requires a trusted HTTPS origin and location permission. HTTP LAN access cannot provide working GPS merely because the map is visible. Earlier missing coordinates are not retroactively fabricated or replaced with the viewer's current location.

## Integrity boundaries

Revision hashes include server receipt times and previous hashes. Database triggers reject UPDATE/DELETE against the new archive tables, and the API has no central delete operation. This provides retained history and detection of inconsistent ledger data, not an independently witnessed or signed timestamp. A database owner can bypass triggers or rewrite a hash chain; separate credentials, restricted database roles and external signed backups are future hardening steps.

Rule statuses, OCR text, device location and capture timestamps originate at the client. A recalculated score is not an independent server audit of the photographs. A hash proves that archived bytes match the supplied fingerprint; it does not prove a photograph was honestly captured. An inspector can erase browser data before it ever reaches the server. Therefore this system supports supervision and investigation; it does not guarantee that fraud or bribery cannot occur.
