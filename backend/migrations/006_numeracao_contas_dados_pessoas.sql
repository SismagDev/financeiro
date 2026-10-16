BEGIN;

ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS numero BIGINT;
-- Bloqueia gravações durante a numeração inicial; nenhuma referência por UUID muda.
LOCK TABLE lancamentos IN SHARE ROW EXCLUSIVE MODE;
WITH maiores AS (
    SELECT empresa_id, COALESCE(MAX(numero), 0) AS ultimo FROM lancamentos GROUP BY empresa_id
), numerados AS (
    SELECT l.id, m.ultimo + ROW_NUMBER() OVER (PARTITION BY l.empresa_id ORDER BY l.created_at, l.id) AS numero
    FROM lancamentos l JOIN maiores m USING (empresa_id) WHERE l.numero IS NULL
)
UPDATE lancamentos l SET numero = n.numero FROM numerados n WHERE n.id = l.id;
ALTER TABLE lancamentos ALTER COLUMN numero SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_empresa_numero_uidx ON lancamentos (empresa_id, numero);

CREATE OR REPLACE FUNCTION gerar_numero_conta() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.numero IS DISTINCT FROM OLD.numero OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
            RAISE EXCEPTION 'O número e a empresa da conta não podem ser alterados';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.numero IS NOT NULL THEN
        RAISE EXCEPTION 'O número da conta é gerado exclusivamente pelo sistema';
    END IF;
    -- Serializa os cadastros da mesma empresa até o fim da transação, inclusive parcelas.
    PERFORM id FROM empresas WHERE id = NEW.empresa_id FOR NO KEY UPDATE;
    SELECT COALESCE(MAX(numero), 0) + 1 INTO NEW.numero
    FROM lancamentos WHERE empresa_id = NEW.empresa_id;
    RETURN NEW;
END;
$$;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lancamentos_numero_sistema' AND tgrelid = 'lancamentos'::regclass) THEN
        CREATE TRIGGER lancamentos_numero_sistema BEFORE INSERT OR UPDATE OF numero, empresa_id ON lancamentos
        FOR EACH ROW EXECUTE FUNCTION gerar_numero_conta();
    END IF;
END;
$$;

ALTER TABLE pessoas
    ADD COLUMN IF NOT EXISTS razao_social VARCHAR(200),
    ADD COLUMN IF NOT EXISTS endereco VARCHAR(500),
    ADD COLUMN IF NOT EXISTS responsavel_nome VARCHAR(200),
    ADD COLUMN IF NOT EXISTS responsavel_cpf VARCHAR(14);
-- Apenas informa dados legados: não atribui vínculos nem remove pessoas.
DO $$
DECLARE quantidade BIGINT;
BEGIN
    SELECT COUNT(*) INTO quantidade FROM pessoas WHERE NOT COALESCE(cliente, FALSE) AND NOT COALESCE(fornecedor, FALSE);
    IF quantidade > 0 THEN
        RAISE NOTICE '% pessoa(s) sem vínculo de cliente ou fornecedor; revisar no cadastro.', quantidade;
    END IF;
END;
$$;

COMMIT;
