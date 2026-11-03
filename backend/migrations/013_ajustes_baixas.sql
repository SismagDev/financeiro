BEGIN;

ALTER TABLE movimentacoes
    ADD COLUMN IF NOT EXISTS desconto NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS acrescimo NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE recebimentos
    ADD COLUMN IF NOT EXISTS desconto NUMERIC(15, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS acrescimo NUMERIC(15, 2) NOT NULL DEFAULT 0;

DO $$
DECLARE tabela TEXT;
BEGIN
    FOREACH tabela IN ARRAY ARRAY['movimentacoes', 'recebimentos'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tabela || '_ajustes_check' AND conrelid = tabela::regclass) THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (desconto >= 0 AND acrescimo >= 0 AND valor + desconto - acrescimo > 0)', tabela, tabela || '_ajustes_check');
        END IF;
    END LOOP;
END $$;

COMMIT;
