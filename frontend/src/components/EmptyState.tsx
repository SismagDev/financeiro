import { Icon } from './Icon'

export function EmptyState({ title, text, action, onAction }: { title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="grid" size={22}/></span><b>{title}</b><p>{text}</p>{action && <button className="button button-outline" onClick={onAction}><Icon name="plus" size={16}/>{action}</button>}</div>
}
