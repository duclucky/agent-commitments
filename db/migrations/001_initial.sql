BEGIN;

CREATE TYPE operation_status AS ENUM ('QUEUED', 'SENDING', 'BROADCAST', 'UNKNOWN', 'CONFIRMED', 'REVERTED');

CREATE TABLE tenants (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_attempts (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  idempotency_key text NOT NULL,
  payload_fingerprint bytea NOT NULL,
  raw_transaction bytea NOT NULL,
  expected_hash bytea NOT NULL,
  tx_hash bytea,
  status operation_status NOT NULL DEFAULT 'QUEUED',
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (expected_hash)
);

CREATE TABLE chain_events (
  chain_id bigint NOT NULL,
  block_number bigint NOT NULL,
  block_hash bytea NOT NULL,
  transaction_index integer NOT NULL,
  tx_hash bytea NOT NULL,
  log_index integer NOT NULL,
  event_name text NOT NULL,
  decoded_payload jsonb NOT NULL,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);

CREATE TABLE indexer_checkpoints (
  chain_id bigint PRIMARY KEY,
  block_number bigint NOT NULL,
  block_hash bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
