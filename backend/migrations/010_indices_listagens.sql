-- Apoia período/ordenação das contas e consultas de baixas por conta e data.
-- Incremental: não altera registros nem substitui índices existentes.
BEGIN;
CREATE INDEX IF NOT EXISTS idx_lancamentos_empresa_vencimento_id
    ON lancamentos (empresa_id, data_vencimento, id);
CREATE INDEX IF NOT EXISTS idx_movimentacoes_empresa_conta_data_id
    ON movimentacoes (empresa_id, lancamento_id, data_movimentacao, id);
CREATE INDEX IF NOT EXISTS idx_recebimentos_empresa_conta_data_id
    ON recebimentos (empresa_id, lancamento_id, data_recebimento, id);
COMMIT;
