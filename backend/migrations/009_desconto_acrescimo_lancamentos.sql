BEGIN;

ALTER TABLE lancamentos
    ADD COLUMN IF NOT EXISTS desconto NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS acrescimo NUMERIC(15, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lancamentos_ajustes_check' AND conrelid = 'lancamentos'::regclass) THEN
        ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_ajustes_check
            CHECK (desconto >= 0 AND acrescimo >= 0 AND valor - desconto + acrescimo >= 0);
    END IF;
END $$;

COMMIT;
