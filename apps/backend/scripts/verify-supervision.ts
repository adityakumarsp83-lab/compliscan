import 'dotenv/config';
import pool from '../src/db.js';
await pool.query(`DO $$
DECLARE id uuid := gen_random_uuid(); event_id uuid := gen_random_uuid(); first_event inspection_events; second_event inspection_events; caught boolean;
BEGIN
  BEGIN
    SELECT * INTO first_event FROM append_inspection_event(event_id,id,'rollback-verification','{"report_json":"{}"}'::jsonb,'[]'::jsonb);
    SELECT * INTO second_event FROM append_inspection_event(event_id,id,'rollback-verification','{"report_json":"{}"}'::jsonb,'[]'::jsonb);
    IF second_event.sequence <> first_event.sequence THEN RAISE EXCEPTION 'Retry created a duplicate'; END IF;
    caught := false;
    BEGIN PERFORM append_inspection_event(event_id,id,'rollback-verification','{"changed":true}'::jsonb,'[]'::jsonb); EXCEPTION WHEN raise_exception THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'Changed event accepted'; END IF;
    caught := false;
    BEGIN PERFORM append_inspection_event(gen_random_uuid(),id,'other-account','{}'::jsonb,'[]'::jsonb); EXCEPTION WHEN raise_exception THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'Ownership was bypassed'; END IF;
    SELECT * INTO second_event FROM append_inspection_event(gen_random_uuid(),id,'rollback-verification','{"revision":2}'::jsonb,'[]'::jsonb);
    IF second_event.previous_hash <> first_event.event_hash THEN RAISE EXCEPTION 'Chain link mismatch'; END IF;
    IF second_event.event_hash <> encode(sha256(convert_to(second_event.previous_hash||second_event.client_event_id::text||second_event.inspection_id::text||second_event.actor_username||to_char(second_event.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||second_event.payload::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'Event hash mismatch'; END IF;
    caught := false;
    BEGIN DELETE FROM inspection_events WHERE inspection_id=id; EXCEPTION WHEN raise_exception THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'History deletion accepted'; END IF;
    caught := false;
    BEGIN UPDATE inspection_events SET payload='{}'::jsonb WHERE inspection_id=id; EXCEPTION WHEN raise_exception THEN caught := true; END;
    IF NOT caught THEN RAISE EXCEPTION 'History overwrite accepted'; END IF;
    RAISE no_data_found;
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  IF EXISTS(SELECT 1 FROM inspection_events WHERE inspection_id=id) THEN RAISE EXCEPTION 'Rollback did not preserve database'; END IF;
END $$;`);
console.log('Verified idempotent retries, ownership, revision hashing, and update/delete protection. Test records rolled back.');
