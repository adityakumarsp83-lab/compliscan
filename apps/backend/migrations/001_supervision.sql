CREATE TABLE IF NOT EXISTS inspection_events (
  sequence BIGSERIAL PRIMARY KEY,
  client_event_id UUID UNIQUE NOT NULL,
  inspection_id UUID NOT NULL,
  actor_username TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  payload JSONB NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inspection_events_latest ON inspection_events(inspection_id, sequence DESC);
CREATE TABLE IF NOT EXISTS inspection_evidence (
  sha256 TEXT PRIMARY KEY,
  bytes BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS inspection_reviews (
  id BIGSERIAL PRIMARY KEY,
  event_sequence BIGINT NOT NULL REFERENCES inspection_events(sequence),
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('REVIEWED', 'ESCALATED')),
  note TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION prevent_inspection_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Inspection evidence and audit history are append-only'; END $$;
DROP TRIGGER IF EXISTS inspection_events_immutable ON inspection_events;
CREATE TRIGGER inspection_events_immutable BEFORE UPDATE OR DELETE ON inspection_events FOR EACH ROW EXECUTE FUNCTION prevent_inspection_history_change();
DROP TRIGGER IF EXISTS inspection_evidence_immutable ON inspection_evidence;
CREATE TRIGGER inspection_evidence_immutable BEFORE UPDATE OR DELETE ON inspection_evidence FOR EACH ROW EXECUTE FUNCTION prevent_inspection_history_change();
DROP TRIGGER IF EXISTS inspection_reviews_immutable ON inspection_reviews;
CREATE TRIGGER inspection_reviews_immutable BEFORE UPDATE OR DELETE ON inspection_reviews FOR EACH ROW EXECUTE FUNCTION prevent_inspection_history_change();

CREATE OR REPLACE FUNCTION append_inspection_event(p_event UUID, p_inspection UUID, p_actor TEXT, p_payload JSONB, p_photos JSONB)
RETURNS SETOF inspection_events LANGUAGE plpgsql AS $$
DECLARE previous inspection_events; existing inspection_events; saved inspection_events;
DECLARE photo JSONB; moment TIMESTAMPTZ; previous_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_inspection::text, 0));
  SELECT * INTO existing FROM inspection_events WHERE client_event_id=p_event;
  IF FOUND THEN
    IF existing.inspection_id<>p_inspection OR existing.actor_username<>p_actor OR existing.payload<>p_payload THEN
      RAISE EXCEPTION 'Event identifier reused with changed data';
    END IF;
    RETURN NEXT existing; RETURN;
  END IF;
  SELECT * INTO previous FROM inspection_events WHERE inspection_id=p_inspection ORDER BY sequence DESC LIMIT 1;
  IF FOUND AND previous.actor_username<>p_actor THEN RAISE EXCEPTION 'Inspection belongs to another account'; END IF;
  FOR photo IN SELECT * FROM jsonb_array_elements(p_photos) LOOP
    IF encode(sha256(decode(photo->>'base64','base64')),'hex')<>photo->>'sha256' THEN RAISE EXCEPTION 'Original photograph hash mismatch'; END IF;
    INSERT INTO inspection_evidence(sha256,bytes,mime_type) VALUES(photo->>'sha256',decode(photo->>'base64','base64'),photo->>'mimeType') ON CONFLICT DO NOTHING;
  END LOOP;
  previous_hash:=COALESCE(previous.event_hash,'GENESIS'); moment:=clock_timestamp();
  INSERT INTO inspection_events(client_event_id,inspection_id,actor_username,received_at,payload,previous_hash,event_hash)
    VALUES(p_event,p_inspection,p_actor,moment,p_payload,previous_hash,
      encode(sha256(convert_to(previous_hash||p_event::text||p_inspection::text||p_actor||to_char(moment AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||p_payload::text,'UTF8')),'hex')) RETURNING * INTO saved;
  RETURN NEXT saved;
END $$;
