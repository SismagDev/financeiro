BEGIN;

ALTER TABLE bancos
    ADD COLUMN IF NOT EXISTS agencia VARCHAR(100),
    ADD COLUMN IF NOT EXISTS conta VARCHAR(100);

-- Não altera cadastros existentes para resolver conflitos de unicidade.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM bancos GROUP BY empresa_id, lower(btrim(descricao)) HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Existem bancos com nomes duplicados na mesma empresa. Revise os cadastros antes de aplicar a migration 014.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM bancos
        WHERE NULLIF(btrim(agencia), '') IS NOT NULL AND NULLIF(btrim(conta), '') IS NOT NULL
        GROUP BY empresa_id, btrim(agencia), btrim(conta) HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Existem bancos com agência e conta duplicadas na mesma empresa. Revise os cadastros antes de aplicar a migration 014.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS bancos_empresa_nome_unique
    ON bancos (empresa_id, lower(btrim(descricao)));

CREATE UNIQUE INDEX IF NOT EXISTS bancos_empresa_agencia_conta_unique
    ON bancos (empresa_id, btrim(agencia), btrim(conta))
    WHERE NULLIF(btrim(agencia), '') IS NOT NULL AND NULLIF(btrim(conta), '') IS NOT NULL;

COMMIT;
