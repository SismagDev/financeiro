import { PAGE_SIZE } from "../hooks/usePagination";

type Props = {
    total: number;
    page: number;
    pageCount: number;
    onPageChange: (page: number) => void;
};

export function Pagination({ total, page, pageCount, onPageChange }: Props) {
    const first = total ? (page - 1) * PAGE_SIZE + 1 : 0;
    const last = Math.min(page * PAGE_SIZE, total);
    return (
        <nav className="pagination" aria-label="Paginação">
            <span role="status">{first}–{last} de {total} registros</span>
            <div className="pagination-controls">
                <button type="button" className="button button-secondary" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                    Anterior
                </button>
                <span>Página {page} de {pageCount}</span>
                <button type="button" className="button button-secondary" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>
                    Próxima
                </button>
            </div>
        </nav>
    );
}
