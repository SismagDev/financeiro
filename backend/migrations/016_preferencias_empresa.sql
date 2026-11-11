BEGIN;

ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS contas_modo_valor TEXT NOT NULL DEFAULT 'total',
    ADD COLUMN IF NOT EXISTS vencimento_dias_urgente INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS vencimento_dias_atencao INTEGER NOT NULL DEFAULT 7,
    ADD COLUMN IF NOT EXISTS avisar_contas_vencidas BOOLEAN NOT NULL DEFAULT TRUE;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'empresas'::regclass AND conname = 'empresas_preferencias_contas_check') THEN
        ALTER TABLE empresas ADD CONSTRAINT empresas_preferencias_contas_check CHECK (
            contas_modo_valor IN ('total', 'parcela')
            AND vencimento_dias_urgente BETWEEN 0 AND 365
            AND vencimento_dias_atencao BETWEEN 1 AND 365
            AND vencimento_dias_atencao > vencimento_dias_urgente
        );
    END IF;
END $$;

COMMIT;
