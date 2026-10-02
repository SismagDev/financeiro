BEGIN;

CREATE TABLE IF NOT EXISTS planos_contas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    descricao VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (empresa_id, id)
);
ALTER TABLE lancamentos
    ADD COLUMN IF NOT EXISTS plano_conta_id UUID,
    ADD COLUMN IF NOT EXISTS competencia TIMESTAMPTZ;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lancamentos_plano_conta_empresa_fk' AND conrelid = 'lancamentos'::regclass) THEN
        ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_plano_conta_empresa_fk
            FOREIGN KEY (empresa_id, plano_conta_id) REFERENCES planos_contas(empresa_id, id);
    END IF;
END $$;
UPDATE lancamentos
SET competencia = date_trunc('month', data_vencimento::timestamp) AT TIME ZONE 'UTC'
WHERE competencia IS NULL;
CREATE INDEX IF NOT EXISTS idx_planos_contas_empresa ON planos_contas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_lancamentos_plano_conta ON lancamentos(empresa_id, plano_conta_id);
COMMIT;

