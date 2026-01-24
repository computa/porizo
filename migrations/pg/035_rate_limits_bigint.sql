-- Migration: Widen window_start_ms to BIGINT for millisecond timestamp support
-- JavaScript Date.now() returns ~1.7e12 (13 digits), which exceeds INTEGER max of 2.1e9
-- BIGINT supports up to 9.2e18, which is safe for millisecond timestamps for ~292 million years

ALTER TABLE rate_limits ALTER COLUMN window_start_ms TYPE BIGINT USING window_start_ms::bigint;
