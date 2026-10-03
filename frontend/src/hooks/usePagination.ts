import { useState } from "react";

export const PAGE_SIZE = 50;

export function usePagination<T>(rows: T[], resetKey: string) {
    const [pagination, setPagination] = useState({ resetKey, page: 1 });
    const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const page = pagination.resetKey === resetKey ? Math.min(pagination.page, pageCount) : 1;

    // Sincroniza mudanças de filtros e redução da lista antes de renderizar a página.
    if (pagination.resetKey !== resetKey || pagination.page !== page) {
        setPagination({ resetKey, page });
    }

    return {
        page,
        pageCount,
        pageRows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        onPageChange: (next: number) => setPagination({ resetKey, page: Math.max(1, Math.min(next, pageCount)) }),
    };
}
