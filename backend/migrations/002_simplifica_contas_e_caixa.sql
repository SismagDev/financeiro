ALTER TABLE lancamentos ADD COLUMN IF NOT EXISTS banco_id uuid;
ALTER TABLE formas_pagamento ADD COLUMN IF NOT EXISTS banco_id uuid;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'formas_pagamento' AND column_name = 'conta_financeira_id')
       AND to_regclass('public.contas_financeiras') IS NOT NULL THEN
        UPDATE formas_pagamento fp
           SET banco_id = cf.banco_id
          FROM contas_financeiras cf
         WHERE fp.conta_financeira_id = cf.id AND fp.banco_id IS NULL;
    END IF;
END $$;

-- O vínculo legado com conta financeira é preservado para não remover dados existentes.


ALTER TABLE lancamentos
    DROP CONSTRAINT IF EXISTS lancamentos_banco_id_fkey,
    ADD CONSTRAINT lancamentos_banco_id_fkey FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE SET NULL;

ALTER TABLE formas_pagamento
    DROP CONSTRAINT IF EXISTS formas_pagamento_banco_id_fkey,
    ADD CONSTRAINT formas_pagamento_banco_id_fkey FOREIGN KEY (banco_id) REFERENCES bancos(id) ON DELETE SET NULL;

DROP TABLE IF EXISTS contas_financeiras CASCADE;
