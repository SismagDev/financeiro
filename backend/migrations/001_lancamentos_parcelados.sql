ALTER TABLE lancamentos
    ADD COLUMN IF NOT EXISTS grupo_parcelamento_id UUID,
    ADD COLUMN IF NOT EXISTS numero_parcela SMALLINT,
    ADD COLUMN IF NOT EXISTS total_parcelas SMALLINT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_lancamentos_parcelamento'
    ) THEN
        ALTER TABLE lancamentos
            ADD CONSTRAINT chk_lancamentos_parcelamento CHECK (
                (grupo_parcelamento_id IS NULL AND numero_parcela IS NULL AND total_parcelas IS NULL)
                OR
                (grupo_parcelamento_id IS NOT NULL AND numero_parcela IS NOT NULL AND total_parcelas IS NOT NULL
                    AND numero_parcela BETWEEN 1 AND total_parcelas
                    AND total_parcelas BETWEEN 2 AND 60)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lancamentos_parcelamento
    ON lancamentos (empresa_id, grupo_parcelamento_id)
    WHERE grupo_parcelamento_id IS NOT NULL;
