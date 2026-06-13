-- Carry the detection's correlation id onto the alert so a responder can pivot
-- from the SNS notification to the health_event / logs for the same incident.
ALTER TABLE "monitoring_outbox" ADD COLUMN "correlation_id" TEXT;
