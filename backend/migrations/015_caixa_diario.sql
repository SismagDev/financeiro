BEGIN;

CREATE TABLE IF NOT EXISTS tipos_caixa_diario (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id),
    descricao VARCHAR(200) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (empresa_id, id)
);
CREATE INDEX IF NOT EXISTS idx_tipos_caixa_diario_empresa ON tipos_caixa_diario(empresa_id);

ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS tipo_caixa_diario_id UUID;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lancamentos_tipo_caixa_diario_empresa_fk' AND conrelid = 'lancamentos'::regclass) THEN
        ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_tipo_caixa_diario_empresa_fk
            FOREIGN KEY (empresa_id, tipo_caixa_diario_id) REFERENCES tipos_caixa_diario(empresa_id, id);
    END IF;
END $$;

COMMIT;
