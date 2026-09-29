import type { Row } from '../types'

export function Status({ value }: { value: Row[string] }) {
  const text = String(value || 'ativo')
  const labels: Record<string, string> = { pendente: 'Pendente', parcial: 'Parcial', pago: 'Pago', cancelado: 'Cancelado', true: 'Ativo', false: 'Inativo' }
  return <span className={`status-pill status-${text}`}>{text === 'pago' || text === 'true' ? <i/> : null}{labels[text] || text}</span>
}
