BEGIN;

ALTER TABLE planos_contas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'ambos';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'planos_contas_tipo_check' AND conrelid = 'planos_contas'::regclass) THEN
        ALTER TABLE planos_contas ADD CONSTRAINT planos_contas_tipo_check CHECK (tipo IN ('receber', 'pagar', 'ambos'));
    END IF;
END $$;

COMMIT;
