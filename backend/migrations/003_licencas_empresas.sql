ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS licenca_expira_em TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_empresas_licenca_expira_em
    ON empresas (licenca_expira_em);
