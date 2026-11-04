import { useMessageBox } from "./hooks/useMessageBox";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AccountSettlements } from "./components/AccountSettlements";
import { SettlementForm } from "./components/SettlementForm";
import { CompanySelect } from "./components/CompanySelect";
import { companyRows, toggleCompany } from "./utils/companies";
import { remainingAmount, settlementPrincipal } from "./utils/accounts";
import { Icon } from "./components/Icon";
import { baixasResource, pageFromPath, pagePaths, resources } from "./data/resources";
import type { Company, ListMeta, OptionLoader, Row, User } from "./types";
import "./App.css";
import "./theme.css";
import { competenceDate, competenceLabel, savedDashboardYear } from "./utils/dates";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const EMPTY_ROWS: Row[] = [];
type Toast = { message: string; type: "success" | "error" };
const loadDashboard = () => import("./pages/DashboardPage").then(({ DashboardPage }) => ({ default: DashboardPage }));
const loadCash = () => import("./pages/CashPage").then(({ CashPage }) => ({ default: CashPage }));
const loadResource = () => import("./components/ResourcePage").then(({ ResourcePage }) => ({ default: ResourcePage }));
const DashboardPage = lazy(loadDashboard);
const CashPage = lazy(loadCash);
const ResourcePage = lazy(loadResource);
function preloadPage(page: string) {
    const load = page === "dashboard" ? loadDashboard : page === "caixa" ? loadCash : loadResource;
    void load().catch(() => { /* A navegação poderá tentar carregar novamente. */ });
}
const RecordFormFields = lazy(() =>
    import("./components/RecordFormFields").then(({ RecordFormFields }) => ({ default: RecordFormFields })),
);

const AdminPage = lazy(() => import("./pages/AdminPage").then(({ AdminPage }) => ({ default: AdminPage })));

async function api(path: string, options: RequestInit = {}, empresaId?: string) {
    const headers = new Headers(options.headers);
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (empresaId) headers.set("x-empresa-id", empresaId);
    const response = await fetch(`${API}${path}`, { ...options, headers, credentials: "include" });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.message || "Não foi possível concluir a solicitação.");
    return body;
}

function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
    const [register, setRegister] = useState(false);
    const [revealPassword, setRevealPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setBusy(true);
        setError("");
        setNotice("");
        const data = Object.fromEntries(new FormData(event.currentTarget));
        try {
            if (register) {
                await api("/auth/register", { method: "POST", body: JSON.stringify(data) });
                setRegister(false);
                setNotice("Conta criada. Entre com seu e-mail e senha para continuar.");
            } else {
                const result = await api("/auth/login", {
                    method: "POST",
                    body: JSON.stringify({ email: data.email, password: data.password }),
                });
                onLogin(result.data);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : "Não foi possível entrar.");
        } finally {
            setBusy(false);
        }
    }
    return (
        <main className="auth-shell">
            <section className="auth-art">
                <div className="brand brand-light">
                    <span className="brand-mark">
                        <Icon name="trend" size={20} />
                    </span>
                    <span>
                        Fluxo<span className="brand-dot">.</span>
                    </span>
                </div>
                <div className="art-copy">
                    <span className="eyebrow">GESTÃO FINANCEIRA</span>
                    <h1>
                        Seu negócio
                        <br />
                        em equilíbrio.
                    </h1>
                    <p>Uma visão clara das entradas, saídas e decisões do dia a dia.</p>
                </div>
                <div className="art-card">
                    <div className="art-card-head">
                        <span>Visão do mês</span>
                        <span className="green-pill">
                            <Icon name="trend" size={14} /> Em dia
                        </span>
                    </div>
                    <div className="art-bars">
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                        <i />
                    </div>
                    <div className="art-card-foot">
                        <span>
                            Entradas <b>R$ 18.420</b>
                        </span>
                        <span>
                            Saídas <b>R$ 11.280</b>
                        </span>
                    </div>
                </div>
                <div className="art-footer">
                    <span>Controle simples, rotina mais leve.</span>
                    <span>01 / 03</span>
                </div>
            </section>
            <section className="auth-form-side">
                <div className="auth-mobile-brand brand">
                    <span className="brand-mark">
                        <Icon name="trend" size={20} />
                    </span>
                    <span>
                        Fluxo<span className="brand-dot">.</span>
                    </span>
                </div>
                <form className="auth-card" onSubmit={submit}>
                    <span className="eyebrow muted">BEM-VINDO AO FLUXO</span>
                    <h2>{register ? "Crie sua conta" : "Acesse sua conta"}</h2>
                    <p className="auth-subtitle">
                        {register
                            ? "Leva menos de um minuto para começar."
                            : "Entre para acompanhar as finanças da sua empresa."}
                    </p>
                    {register && (
                        <label>
                            Seu nome
                            <input
                                name="nome"
                                autoComplete="name"
                                placeholder="Como podemos chamar você?"
                                required
                                minLength={2}
                            />
                        </label>
                    )}
                    <label>
                        E-mail
                        <input
                            name="email"
                            type="email"
                            autoComplete="email"
                            placeholder="voce@empresa.com.br"
                            required
                        />
                    </label>
                    <label>
                        Senha
                        <span className="password-field"><input
                            name="password"
                            type={revealPassword ? "text" : "password"}
                            autoComplete={register ? "new-password" : "current-password"}
                            placeholder="Mínimo de 6 caracteres"
                            required
                            minLength={6}
                        /><button type="button" className="password-toggle" aria-label={revealPassword ? "Ocultar senha" : "Revelar senha"} aria-pressed={revealPassword} onClick={() => setRevealPassword(!revealPassword)}><Icon name={revealPassword ? "eyeOff" : "eye"} /></button></span>
                    </label>
                    {error && <div className="inline-error">{error}</div>}
                    {notice && <div className="inline-success">{notice}</div>}
                    <button className="button button-primary auth-submit" disabled={busy}>
                        {busy && <span className="spinner" />}
                        {busy ? "Aguarde..." : register ? "Criar conta" : "Entrar"}
                        <span className="button-arrow">→</span>
                    </button>
                    <div className="auth-switch">
                        {register ? "Já tem uma conta?" : "Ainda não tem uma conta?"}{" "}
                        <button
                            type="button"
                            onClick={() => {
                                setRegister(!register);
                                setError("");
                                setNotice("");
                            }}
                        >
                            {register ? "Fazer login" : "Criar conta"}
                        </button>
                    </div>
                    <p className="auth-secure">
                        <Icon name="check" size={15} /> Seus dados ficam protegidos.
                    </p>
                </form>
                <span className="auth-copyright">© 2026 Fluxo Financeiro</span>
            </section>
        </main>
    );
}

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const authRequested = useRef(false);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [company, setCompany] = useState<Company | null>(null);
    const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
    const [companyFilter, setCompanyFilter] = useState("");
    const [formCompany, setFormCompany] = useState("");
    const [loadError, setLoadError] = useState("");
    const loadVersion = useRef(0);
    const formVersion = useRef(0);
    const selectedCompanies = useMemo(() => companies.filter(item => selectedCompanyIds.includes(item.id)), [companies, selectedCompanyIds]);
    const activeCompanyId = useRef<string | null>(null);
    const [page, setPage] = useState(() => pageFromPath(window.location.pathname));
    const [loadedCompanyId, setLoadedCompanyId] = useState<string | null>(null);
    const warningMemory = useRef<Record<string, string>>({});

    const [lookups, setLookups] = useState<Record<string, Row[]>>({});
    const dashboardData = useMemo(() => companyRows(lookups, selectedCompanyIds, companyFilter), [lookups, selectedCompanyIds, companyFilter]);

    const [listResult, setListResult] = useState<{ key: string; data: Row[]; meta: ListMeta; balance: number } | null>(null);
    const [summary, setSummary] = useState<{ scope: string; rows: Row[]; flowRows: Row[]; overdueRows: Row[]; pagar: number; receber: number; totalPaid: number; overdue: number } | null>(null);
    const [dashboardYear, setDashboardYear] = useState(() => {
        try { return savedDashboardYear(localStorage.getItem("fluxo-dashboard-year")); } catch { return new Date().getFullYear(); }
    });
    useEffect(() => {
        try { localStorage.setItem("fluxo-dashboard-year", String(dashboardYear)); } catch { /* Mantém a escolha durante a sessão. */ }
    }, [dashboardYear]);
    const [alerts, setAlerts] = useState<{ scope: string; overdue: number; overdueRows: Row[] } | null>(null);
    const alertVersion = useRef(0);
    const requestController = useRef<AbortController | null>(null);
    const [pagination, setPagination] = useState({ key: "", page: 1 });
    const [sorting, setSorting] = useState<{ page: string; key: string; direction: "asc" | "desc" }>({ page: "", key: "", direction: "asc" });
    const [detailsRevision, setDetailsRevision] = useState(0);
    const [cashInitial, setCashInitial] = useState(0);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [modal, setModalState] = useState<"create" | "edit" | "company" | "company-edit" | "settle" | "details" | null>(null);
    const [selectedRow, setSelectedRow] = useState<Row | null>(null);
    const [createAccountType, setCreateAccountType] = useState<"receber" | "pagar" | undefined>(undefined);
    function setModal(next: typeof modal, tipo?: "receber" | "pagar") {
        formVersion.current++;
        if (next === "create") { setFormCompany(selectedCompanies[0]?.id || ""); setSelectedRow(null); setCreateAccountType(tipo); }
        setModalState(next);
    }
    const formCompanyId = modal !== "create" && selectedRow ? String(selectedRow.empresa_id || "") : formCompany || selectedCompanies[0]?.id || "";
    const formLookups = useMemo(() => {
        const data = companyRows(lookups, selectedCompanyIds, formCompanyId);
        if (selectedRow) for (const [key, idField, labelField] of [["pessoas", "pessoa_id", "pessoa_nome"], ["planos", "plano_conta_id", "plano_conta_descricao"], ["bancos", "banco_id", "banco_descricao"], ["formas", "forma_pagamento_id", "forma_pagamento_descricao"], ["lancamentos", "lancamento_id", "descricao"]]) {
            if (selectedRow[idField] && selectedRow[labelField] && !(data[key] || []).some(row => row.id === selectedRow[idField]))
                data[key] = [...(data[key] || []), { id: selectedRow[idField], nome: selectedRow[labelField], descricao: selectedRow[labelField], empresa_id: formCompanyId }];
        }
        return data;
    }, [lookups, selectedCompanyIds, formCompanyId, selectedRow]);
    const [search, setSearch] = useState("");
    const [settlementFilters, setSettlementFilters] = useState({
        dataInicial: "", dataFinal: "", formaPagamento: "", mostrarRecebimentos: true, mostrarPagamentos: true,
    });
    const [personFilters, setPersonFilters] = useState({ mostrarClientes: true, mostrarFornecedores: true });
    const [settlementOverlay, setSettlementOverlay] = useState(false);
    const [zoom, setZoom] = useState(100);
    useEffect(() => {
        document.documentElement.style.setProperty("--app-zoom", String(zoom / 100));
        return () => { document.documentElement.style.removeProperty("--app-zoom"); };
    }, [zoom]);
    const currentMonth = new Date();
    const [lancamentoFilters, setLancamentoFilters] = useState<{
        formaPagamento: string;
        mostrarEmAberto: boolean;
        dataInicial: string;
        dataFinal: string;
        mostrarPagos: boolean;
        tipo: "todos" | "pagar" | "receber";
    }>(() => ({
        formaPagamento: "",
        mostrarEmAberto: true,
        dataInicial: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
            .toISOString()
            .slice(0, 10),
        dataFinal: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
            .toISOString()
            .slice(0, 10),
        mostrarPagos: false,
        tipo: "todos",
    }));
    useEffect(() => {
        if (!modal) return;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const frame = window.requestAnimationFrame(() => {
            const dialog = document.querySelector<HTMLElement>(settlementOverlay ? ".settlement-overlay [role=dialog]" : ".modal-backdrop [role=dialog]");
            dialog?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled]):not([type=hidden])")?.focus();
        });
        return () => { window.cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus(); };
    }, [modal, settlementOverlay]);
    const [toast, setToast] = useState<Toast | null>(null);
    const [mobileNav, setMobileNav] = useState(false);
    const [companyMenu, setCompanyMenu] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);
    const { ask, messageBox } = useMessageBox();

    const warningDay = warningDateFormatter.format(new Date());
    const scopeIds = useMemo(() => selectedCompanies.filter(item => item.licenca_status !== "vencida" && (!companyFilter || item.id === companyFilter)).map(item => item.id), [selectedCompanies, companyFilter]);
    const scopeKey = scopeIds.join(",");
    const dashboardScopeKey = `${scopeKey}:${dashboardYear}`;
    const overdueRows = alerts?.scope === scopeKey ? alerts.overdueRows : EMPTY_ROWS;
    const overdue = alerts?.scope === scopeKey ? Number(alerts.overdue) : 0;
    useEffect(() => {
        if (!user || !company || loadedCompanyId !== company.id || !overdue || modal || company.licenca_status === "vencida") return;
        const key = "fluxo-overdue-warning:" + user.id + ":" + company.id;
        const frame = window.requestAnimationFrame(() => {
            if (activeCompanyId.current !== company.id || warningMemory.current[key] === warningDay) return;
            let last = warningMemory.current[key];
            try { last = localStorage.getItem(key) || last; } catch { /* Mantém o controle em memória se o armazenamento estiver bloqueado. */ }
            if (last === warningDay) { warningMemory.current[key] = warningDay; return; }
            setNotificationsOpen(true);
            warningMemory.current[key] = warningDay;
            try { localStorage.setItem(key, warningDay); } catch { /* A abertura manual permanece disponível. */ }
        });
        return () => window.cancelAnimationFrame(frame);
    }, [user, company, loadedCompanyId, overdue, warningDay, modal]);
    useEffect(() => {
        if (!companyMenu && !notificationsOpen) return;
        const outside = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (!target.closest(".company-switch, .company-dropdown")) setCompanyMenu(false);
            if (!target.closest(".notification-anchor")) setNotificationsOpen(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") { setCompanyMenu(false); setNotificationsOpen(false); }
        };
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape);
        return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
    }, [companyMenu, notificationsOpen]);

    function navigate(next: string) {
        if (next === "movimentacoes" || next === "recebimentos") next = "baixas";
        preloadPage(next);
        const path = pagePaths[next] || "/";
        if (window.location.pathname !== path) window.history.pushState({}, "", path);
        setPage(pagePaths[next] ? next : "dashboard");
    }

    useEffect(() => {
        const onPopState = () => setPage(pageFromPath(window.location.pathname));
        window.addEventListener("popstate", onPopState);
        if (!pagePaths[page]) window.history.replaceState({}, "", "/");
        return () => window.removeEventListener("popstate", onPopState);
    }, [page]);

    const loadCompanies = useCallback(async (userId?: string) => {
        const result = await api("/empresas");
        const list: Company[] = result.data || [];
        setCompanies(list);
        let saved: string[] = [];
        try { saved = JSON.parse(localStorage.getItem("fluxo-companies:" + (userId || "")) || "[]"); } catch { /* Usa a primeira empresa se a preferência estiver inválida. */ }
        const selected = list.filter(item => Array.isArray(saved) && saved.includes(item.id));
        const chosen = selected[0] || list[0] || null;
        setSelectedCompanyIds(selected.length ? selected.map(item => item.id) : chosen ? [chosen.id] : []);
        setCompanyFilter("");
        activeCompanyId.current = chosen?.id ?? null;
        setCompany(chosen);
        if (chosen) localStorage.setItem("fluxo-company", chosen.id);
        else localStorage.removeItem("fluxo-company");
        setLoading(false);
        return chosen;
    }, []);

    useEffect(() => {
        if (authRequested.current) return;
        authRequested.current = true;
        api("/auth/me")
            .then((result) => {                setUser(result.data);
                setAuthChecked(true);
                if (result.data.role === "admin") { setLoading(false); return; }
                return loadCompanies(result.data.id);
            })
            .catch(() => {
                setUser(null);
                setLoading(false);
                setAuthChecked(true);
            });
    }, [loadCompanies]);

    const resource = page === "baixas" ? baixasResource : resources.find(item => item.key === page);
    const dateFilters = page === "baixas" ? settlementFilters : undefined;
    const sort = sorting.page === page ? sorting : { key: page === "lancamentos" ? "data_vencimento" : page === "baixas" ? "data_baixa" : page === "caixa" ? "data_baixa" : "created_at", direction: page === "lancamentos" || page === "caixa" ? "asc" as const : "desc" as const };
    const filterKey = JSON.stringify([page, scopeKey, search, page === "lancamentos" ? lancamentoFilters : null, dateFilters, page === "pessoas" ? personFilters : null, sort.key, sort.direction, page === "dashboard" ? dashboardYear : null]);
    const requestedPage = pagination.key === filterKey ? pagination.page : 1;
    const pageQuery = useMemo(() => {
        const params = new URLSearchParams({ empresas: scopeKey, pagina: String(requestedPage), tamanho: "50", ordem: sort.key, direcao: sort.direction });
        if (page !== "caixa" && search.trim()) params.set("busca", search.trim());
        if (page === "lancamentos") {
            params.set("mostrar_em_aberto", String(lancamentoFilters.mostrarEmAberto));
            params.set("mostrar_pagos", String(lancamentoFilters.mostrarPagos));
            if (lancamentoFilters.tipo !== "todos") params.set("tipo", lancamentoFilters.tipo);
            if (lancamentoFilters.formaPagamento) params.set("forma_pagamento_id", lancamentoFilters.formaPagamento);
            if (lancamentoFilters.dataInicial) params.set("data_inicial", lancamentoFilters.dataInicial);
            if (lancamentoFilters.dataFinal) params.set("data_final", lancamentoFilters.dataFinal);
        }
        if (page === "baixas") {
            params.set("unificadas", "true");
            params.set("mostrar_recebimentos", String(settlementFilters.mostrarRecebimentos));
            params.set("mostrar_pagamentos", String(settlementFilters.mostrarPagamentos));
            if (settlementFilters.formaPagamento) params.set("forma_pagamento_id", settlementFilters.formaPagamento);
            if (!(settlementFilters.dataInicial && settlementFilters.dataFinal && settlementFilters.dataInicial > settlementFilters.dataFinal)) {
                if (settlementFilters.dataInicial) params.set("data_inicial", settlementFilters.dataInicial);
                if (settlementFilters.dataFinal) params.set("data_final", settlementFilters.dataFinal);
            }
        }
        if (page === "pessoas") {
            params.set("mostrar_clientes", String(personFilters.mostrarClientes));
            params.set("mostrar_fornecedores", String(personFilters.mostrarFornecedores));
        }
        const endpoint = page === "dashboard" ? "/lancamentos" : page === "caixa" ? "/caixa" : page === "baixas" ? "/movimentacoes" : resource?.endpoint;
        return page === "dashboard" ? `/lancamentos?resumo=dashboard&empresas=${scopeKey}&ano=${dashboardYear}` : endpoint ? endpoint + "?" + params : "";
    }, [page, scopeKey, requestedPage, sort.key, sort.direction, search, lancamentoFilters, settlementFilters, personFilters, resource?.endpoint, dashboardYear]);
    const fetchResources = useCallback(async () => {
        const version = ++loadVersion.current;
        requestController.current?.abort();
        const controller = new AbortController();
        requestController.current = controller;
        if (!scopeKey || !pageQuery) { setListResult(null); setLoadError(""); setLoading(false); return; }
        setLoading(true); setLoadError("");
        try {
            const result = await api(pageQuery, { signal: controller.signal }, scopeKey.split(",")[0]);
            if (version !== loadVersion.current) return;
            if (page === "dashboard") { setSummary({ scope: dashboardScopeKey, ...result.data }); setAlerts({ scope: scopeKey, overdue: Number(result.data.overdue), overdueRows: result.data.overdueRows }); }
            else setListResult({ key: filterKey, data: result.data, meta: result.meta, balance: Number(result.saldo_atual || 0) });
            setLoadedCompanyId(scopeKey.split(",")[0]);
        } catch (error) {
            if (version !== loadVersion.current || controller.signal.aborted) return;
            setListResult(null);
            setLoadError(error instanceof Error ? error.message : "Não foi possível carregar os dados.");
        } finally { if (version === loadVersion.current) setLoading(false); }
    }, [pageQuery, scopeKey, filterKey, page, dashboardScopeKey]);
    useEffect(() => {
        const version = loadVersion;
        const timer = window.setTimeout(() => { void fetchResources(); }, 200);
        return () => { window.clearTimeout(timer); version.current++; requestController.current?.abort(); };
    }, [fetchResources]);
    const fetchAlerts = useCallback(async () => {
        const version = ++alertVersion.current;
        if (!scopeKey) return;
        try {
            const result = await api("/lancamentos?resumo=alertas&empresas=" + scopeKey, {}, scopeKey.split(",")[0]);
            if (version === alertVersion.current) { setAlerts({ scope: scopeKey, ...result.data }); setLoadedCompanyId(scopeKey.split(",")[0]); }
        } catch { if (version === alertVersion.current) setAlerts(null); }
    }, [scopeKey]);
    useEffect(() => {
        if (page === "dashboard" || alerts?.scope === scopeKey) return;
        const version = alertVersion;
        const timer = window.setTimeout(() => { void fetchAlerts(); }, 200);
        return () => { window.clearTimeout(timer); version.current++; };
    }, [page, scopeKey, alerts?.scope, fetchAlerts]);
    const currentRows = listResult?.key === filterKey ? listResult.data : EMPTY_ROWS;
    const filteredRows = currentRows;
    const listMeta = listResult?.key === filterKey ? listResult.meta : { total: 0, pagina: 1, paginas: 1 };
    const cashRows = useMemo(() => currentRows.map(row => ({ ...row, saldo_antes: cashInitial + Number(row.saldo_antes), saldo_depois: cashInitial + Number(row.saldo_depois) })), [currentRows, cashInitial]);

    const fetchOptions = useCallback(async (source: string, query: string, nextPage: number, ids: string[], version: number) => {
        const descriptions = source === "descricoes" || source.startsWith("descricoes:");
        const key = source.startsWith("planos:") ? "planos" : source === "formasAtivas" ? "formas" : descriptions ? "lancamentos" : source;
        const endpoint = resources.find(item => item.key === key)?.endpoint;
        if (!endpoint || !ids.length) return { options: [], hasMore: false };
        const params = new URLSearchParams({ pagina: String(nextPage), tamanho: "50", empresas: ids.join(","), busca: query, opcoes: descriptions ? "descricoes" : "true" });
        if (source === "formasAtivas") params.set("ativo", "true");
        if (source.startsWith("planos:")) params.set("tipo_conta", source.split(":")[1]);
        if (source.startsWith("descricoes:")) params.set("plano_conta_id", source.slice("descricoes:".length));
        const result = await api(endpoint + "?" + params, {}, ids[0]);
        if (version !== formVersion.current) throw new Error("A empresa ou o formulário foi alterado.");
        setLookups(previous => ({ ...previous, [key]: Array.from(new Map([...(previous[key] || []), ...result.data].map(row => [String(row.empresa_id) + ":" + row.id, row])).values()) }));
        const options: [string, string][] = result.data.map((row: Row) => [String(descriptions ? String(row.descricao).trim() : row.id),
            source === "lancamentos" ? [row.pessoa_nome, row.descricao, row.tipo === "receber" ? "Recebimento" : "Pagamento"].filter(Boolean).join(" · ") : String(row.nome || row.descricao || row.id)]);
        return { options, hasMore: result.meta.pagina < result.meta.paginas };
    }, []);
    const loadFormOptions: OptionLoader = useCallback((source, query, nextPage) => fetchOptions(source, query, nextPage, formCompanyId ? [formCompanyId] : [], formVersion.current), [fetchOptions, formCompanyId]);
    const loadFilterOptions: OptionLoader = useCallback((source, query, nextPage) => fetchOptions(source, query, nextPage, scopeKey ? scopeKey.split(",") : [], formVersion.current), [fetchOptions, scopeKey]);
    const detailAccountId = selectedRow?.id, detailCompanyId = selectedRow?.empresa_id, detailType = selectedRow?.tipo;
    const loadAccountSettlements = useCallback(async (filters: { dataInicial: string; dataFinal: string; formaPagamento: string }, nextPage: number) => {
        if (!detailAccountId) return { data: EMPTY_ROWS, meta: { total: 0, pagina: 1, paginas: 1 } };
        const params = new URLSearchParams({ lancamento_id: String(detailAccountId), pagina: String(nextPage), tamanho: "50", ordem: "data_baixa", direcao: "desc" });
        if (filters.formaPagamento) params.set("forma_pagamento_id", filters.formaPagamento);
        if (!(filters.dataInicial && filters.dataFinal && filters.dataInicial > filters.dataFinal)) {
            if (filters.dataInicial) params.set("data_inicial", filters.dataInicial);
            if (filters.dataFinal) params.set("data_final", filters.dataFinal);
        }
        const key = detailType === "receber" ? "recebimentos" : "movimentacoes";
        const result = await api("/" + key + "?" + params, {}, String(detailCompanyId));
        return result as { data: Row[]; meta: ListMeta };
    }, [detailAccountId, detailCompanyId, detailType]);
    const notify = (message: string, type: Toast["type"] = "success") => {
        setToast({ message, type });
        window.setTimeout(() => setToast(null), 3200);
    };

    async function onLogin(nextUser: User) {
        setUser(nextUser);
        setAuthChecked(true);
        if (nextUser.role === "admin") { setLoading(false); return; }
        setLoading(true);
        try {
            await loadCompanies(nextUser.id);
        } catch {
            setCompanies([]);
            activeCompanyId.current = null;
            setCompany(null);
        }
        setLoading(false);
    }
    async function logout() {
        try {
            await api("/auth/logout", { method: "POST" });
        } finally {
            setUser(null);
            formVersion.current++; alertVersion.current++;
            setSummary(null); setAlerts(null); setListResult(null);
            activeCompanyId.current = null;
            setLoadedCompanyId(null); setNotificationsOpen(false);
            setLookups({});
            setCompany(null);
            setCompanies([]); setSelectedCompanyIds([]); setCompanyFilter(""); loadVersion.current++;
            localStorage.removeItem("fluxo-company");
        }
    }
    function changeCompany(next: Company) {
        const ids = toggleCompany(selectedCompanyIds, next.id);
        if (ids === selectedCompanyIds) return;
        loadVersion.current++; formVersion.current++;
        setSelectedCompanyIds(ids); setLookups({}); setLoading(true);
        const first = companies.find(item => ids.includes(item.id)) || null;
        activeCompanyId.current = first?.id || null;
        setCompany(first);
        setLoadedCompanyId(null); setNotificationsOpen(false);
        setModal(null); setSelectedRow(null); setSettlementOverlay(false);
        if (companyFilter && !ids.includes(companyFilter)) setCompanyFilter("");
        setLancamentoFilters(current => ({ ...current, formaPagamento: "" }));
        setSettlementFilters(current => ({ ...current, formaPagamento: "" }));
        localStorage.setItem("fluxo-companies:" + user?.id, JSON.stringify(ids));
    }

    function changeCompanyFilter(id: string) {
        setCompanyFilter(id);
        setLancamentoFilters(current => ({ ...current, formaPagamento: "" }));
        setSettlementFilters(current => ({ ...current, formaPagamento: "" }));
    }

    async function openNotifiedAccount(row: Row) {
        setNotificationsOpen(false);
        const version = ++formVersion.current;
        try {
            const result = await api(`/lancamentos/${row.id}`, {}, String(row.empresa_id));
            if (version !== formVersion.current) return;
            navigate("lancamentos");
            setSelectedRow(result.data);
            setModal("edit");
        } catch (error) {
            if (version === formVersion.current) notify(error instanceof Error ? error.message : "Não foi possível localizar a conta.", "error");
        }
    }

    async function confirmSettlementExtra(accountId: string, empresaId: string, value: number, previousValue = 0): Promise<Row | null> {
        const version = formVersion.current;
        const result = await api(`/lancamentos/${accountId}`, {}, empresaId);
        if (version !== formVersion.current) return null;
        const balanceCents = Math.round(remainingAmount(result.data, {}) * 100) + Math.round(previousValue * 100);
        const extraCents = Math.round(value * 100) - balanceCents;
        if (extraCents <= 0) return {};
        const formatted = (extraCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        if (!(await ask({ title: "Confirmar acréscimo", message: `O valor da baixa supera o saldo em ${formatted}. Deseja adicionar esse acréscimo somente a esta conta/parcela e registrar a baixa?`, confirmLabel: "Adicionar acréscimo e dar baixa" })) || version !== formVersion.current) return null;
        return { acrescimo_confirmado: extraCents / 100, saldo_confirmado: balanceCents / 100 };
    }

    async function saveRecord(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!company || !resource || busy) return;
        setBusy(true);
        const form = new FormData(event.currentTarget);
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const openSettlement = modal === "create" && resource.key === "lancamentos" && submitter instanceof HTMLButtonElement && submitter.value === "gravar-baixa";
        const version = formVersion.current;
        const payload: Row = {};
        if (resource.key === "lancamentos") {
            payload.desconto = Number(form.get("desconto") || 0);
            payload.acrescimo = Number(form.get("acrescimo") || 0);
        }
        for (const field of resource.fields) {
            const value = form.get(field.name);
            if (field.type === "checkbox") payload[field.name] = value === "on";
            else if (["observacoes", "razao_social", "endereco", "responsavel_nome", "responsavel_cpf", "num_doc"].includes(field.name)) payload[field.name] = String(value || "").trim() || null;
            else if (field.name === "competencia" && typeof value === "string") payload[field.name] = competenceDate(value);
            else if ((field.name === "plano_conta_id" || field.name === "pessoa_id") && value === "" && modal === "edit") payload[field.name] = null;
            else if (typeof value === "string" && value !== "")
                payload[field.name] = field.type === "number" ? Number(value) : value;
        }
        try {
            const editing = modal === "edit" && selectedRow?.id;
            const parcelas = Number(payload.parcelas || 1);
            const modoValor = String(form.get("modo_valor") || "total");
            const customInstallments = !editing && resource.key === "lancamentos" && form.get("parcelas_personalizadas")
                ? JSON.parse(String(form.get("parcelas_personalizadas"))) as { valor: number; data_vencimento: string }[] : undefined;
            const detalharParcelamento = form.get("detalhar_parcelamento") === "on";
            const intervalos = String(form.get("intervalos") || "")
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isInteger(item) && item > 0);
            delete payload.parcelas;
            let settlementEndpoint = "";
            if (resource.key === "baixas") {
                const account = (lookups.lancamentos || []).find(item => item.id === payload.lancamento_id);
                const origin = editing ? selectedRow.origem : account?.tipo === "receber" ? "recebimentos" : "movimentacoes";
                if (!editing && !account) throw new Error("Selecione a conta para registrar a baixa.");
                if (origin !== "recebimentos" && origin !== "movimentacoes") throw new Error("Tipo de baixa inválido.");
                settlementEndpoint = "/" + origin;
                if (payload.data_baixa) payload[origin === "recebimentos" ? "data_recebimento" : "data_movimentacao"] = payload.data_baixa;
                delete payload.data_baixa;
                if (editing) delete payload.lancamento_id;
                const confirmation = await confirmSettlementExtra(String(editing ? selectedRow.lancamento_id : payload.lancamento_id), formCompanyId,
                    settlementPrincipal({ ...(editing ? selectedRow : {}), valor: payload.valor ?? selectedRow?.valor }), editing ? settlementPrincipal(selectedRow) : 0);
                if (!confirmation) return;
                Object.assign(payload, confirmation);
            }
            const endpoint =
                !editing && resource.key === "lancamentos" && parcelas > 1
                    ? "/lancamentos/parcelado"
                    : `${settlementEndpoint || resource.endpoint}${editing ? `/${selectedRow.id}` : ""}`;
            const result = await api(
                endpoint,
                {
                    method: editing ? "PATCH" : "POST",
                    body: JSON.stringify({
                        ...payload,
                        ...(customInstallments ? { parcelas_personalizadas: customInstallments } : {}),
                        ...(!editing && resource.key === "lancamentos" && parcelas > 1
                            ? {
                                  parcelas,
                                  modo_valor: modoValor,
                                  ...(detalharParcelamento ? { intervalos } : {}),
                              }
                            : {}),
                    }),
                },
                formCompanyId,
            );
            if (version !== formVersion.current) return;
            notify(
                editing
                    ? "Alterações salvas."
                    : parcelas > 1 && resource.key === "lancamentos"
                      ? `${parcelas} parcelas criadas.`
                      : `${resource.singular[0].toUpperCase()}${resource.singular.slice(1)} cadastrado${resource.key === "pessoas" ? "a" : ""}.`,
            );
            setModal(null);
            setSelectedRow(null);
            if (openSettlement) {
                const settlementVersion = formVersion.current;
                try {
                    const createdId = parcelas > 1 ? result.ids[0] : result.id;
                    const saved = await api(`/lancamentos/${createdId}`, {}, formCompanyId);
                    if (settlementVersion !== formVersion.current) return;
                    setSelectedRow(saved.data);
                    setModal("settle");
                } catch (error) {
                    notify(`Conta gravada, mas não foi possível abrir a baixa. ${error instanceof Error ? error.message : "Tente pela listagem de Contas."}`, "error");
                }
            }
            await reloadCurrent();
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível salvar.", "error");
        } finally {
            setBusy(false);
        }
    }


    async function settleLaunch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!company || !selectedRow) return;
        const values = Object.fromEntries(new FormData(event.currentTarget));
        setBusy(true);
        try {
            await api(
                `/lancamentos/${selectedRow.id}/baixar`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        forma_pagamento_id: values.forma_pagamento_id,
                        valor: Number(values.valor),
                        data: values.data,
                        desconto: Number(values.desconto || 0),
                        acrescimo: Number(values.acrescimo || 0),
                    }),
                },
                String(selectedRow.empresa_id),
            );
            await reloadCurrent();
            if (activeCompanyId.current !== company.id) return;
            if (settlementOverlay) setSettlementOverlay(false);
            else { setModal(null); setSelectedRow(null); }
            notify("Baixa registrada e status atualizado.");
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível registrar a baixa.", "error");
        } finally {
            setBusy(false);
        }
    }

    async function removeSettlement(row: Row) {
        if (!company || !selectedRow || busy || !(await ask({ title: "Excluir baixa", message: "Remover esta baixa? O saldo da conta será atualizado.", confirmLabel: "Excluir baixa", danger: true }))) return;
        if (activeCompanyId.current !== company.id) return;
        const key = selectedRow.tipo === "receber" ? "recebimentos" : "movimentacoes";
        setBusy(true);
        try {
            await api(`/${key}/${row.id}`, { method: "DELETE" }, String(selectedRow.empresa_id));
            if (activeCompanyId.current !== company.id) return;

            await reloadCurrent();
            notify("Baixa removida e saldo atualizado.");
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível remover a baixa.", "error");
        } finally { setBusy(false); }
    }

    async function reloadCurrent() {
        setDetailsRevision(value => value + 1);
        const version = formVersion.current;
        await Promise.all([fetchResources(), ["lancamentos", "baixas", "caixa"].includes(page) ? fetchAlerts() : Promise.resolve(),
            selectedRow && page === "lancamentos" && (modal === "details" || modal === "edit" || settlementOverlay)
                ? api("/lancamentos/" + selectedRow.id, {}, String(selectedRow.empresa_id)).then(result => { if (version === formVersion.current) setSelectedRow(result.data); })
                : Promise.resolve()]);
    }

    async function createPerson(values: Row): Promise<Row> {
        if (!company) throw new Error("Selecione uma empresa.");
        const version = formVersion.current;
        const result = await api("/pessoas", { method: "POST", body: JSON.stringify(values) }, formCompanyId);
        if (version !== formVersion.current) throw new Error("A empresa selecionada foi alterada.");
        const row = { ...values, id: result.id, empresa_id: formCompanyId, empresa_identificador: companies.find(item => item.id === formCompanyId)?.identificador ?? null };
        setLookups(current => ({ ...current, pessoas: [...(current.pessoas || []), row] }));
        return row;
    }

    async function removeRow(row: Row) {
        if (!company || !resource || !(await ask({ title: "Excluir registro", message: `Excluir este registro de ${resource.singular}?`, confirmLabel: "Excluir registro", danger: true })))
            return;
        if (activeCompanyId.current !== company.id) return;
        try {
            await api(`${resource.key === "baixas" ? "/" + row.origem : resource.endpoint}/${row.id}`, { method: "DELETE" }, String(row.empresa_id));
            notify("Registro excluído.");
            await reloadCurrent();
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível excluir.", "error");
        }
    }

    async function updateCompany(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!company) return;
        setBusy(true);
        const values = Object.fromEntries(new FormData(event.currentTarget));
        try {
            await api(`/empresas/${company.id}`, {
                method: "PATCH",
                body: JSON.stringify({ nome: values.nome, caixa_data_inicio: values.caixa_data_inicio || null, ...(user?.role === "admin" ? { cnpj: values.cnpj || null } : {}) }),
            }, company.id);
            await loadCompanies(user?.id);
            if (page === "caixa") await fetchResources();
            setModal(null);
            notify("Dados da empresa atualizados.");
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível atualizar a empresa.", "error");
        } finally {
            setBusy(false);
        }
    }
    if (!authChecked)
        return (
            <div className="full-loader">
                <span className="spinner spinner-large" />
                <span>Verificando acesso...</span>
            </div>
        );
    if (!user) return <AuthScreen onLogin={onLogin} />;
    if (user.role === "admin") return <Suspense fallback={<div className="full-loader"><span className="spinner spinner-large" /></div>}><AdminPage user={user} request={api} onLogout={logout} /></Suspense>;
    if (loading && !companies.length)
        return (
            <div className="full-loader">
                <span className="spinner spinner-large" />
                <span>Preparando seu espaço...</span>
            </div>
        );
    if (!company)
        return (
            <main className="onboarding">
                <div className="onboarding-logo"><span className="brand-mark"><Icon name="trend" /></span><b>Fluxo<span className="brand-dot">.</span></b></div>
                <div className="onboarding-card"><div className="onboarding-icon"><Icon name="bank" size={26} /></div><span className="eyebrow muted">ACESSO PENDENTE</span><h1>Você ainda não possui<br />uma empresa vinculada.</h1><p>Peça a um administrador para vincular seu usuário a uma empresa.</p><button className="text-button" onClick={logout}>Sair da conta</button></div>
            </main>
        );
    const companyFilterControl = <CompanySelect companies={selectedCompanies} visible={companies.length > 1} value={companyFilter} onChange={changeCompanyFilter} />;
    const currentAccount = selectedRow && currentRows.find(row => row.id === selectedRow.id && row.empresa_id === selectedRow.empresa_id) || selectedRow;
    const nav = [
        { key: "dashboard", title: "Visão geral", icon: "grid", section: "WORKSPACE" },
        { key: "lancamentos", title: "Contas", icon: "arrows", section: "FINANCEIRO" },
        { key: "pessoas", title: "Pessoas", icon: "users", section: "CADASTROS" },
        { key: "caixa", title: "Gestão de caixa", icon: "wallet", section: "FINANCEIRO" },
        { key: "formas", title: "Formas de pagamento", icon: "card", section: "CADASTROS" },
        { key: "bancos", title: "Bancos", icon: "bank", section: "CADASTROS" },
        { key: "planos", title: "Planos de contas", icon: "grid", section: "CADASTROS" },
        { key: "baixas", title: "Baixas", icon: "check", section: "FINANCEIRO" },
    ];
    const grouped = ["WORKSPACE", "FINANCEIRO", "CADASTROS"];
    const visibleRows = summary?.scope === dashboardScopeKey ? summary.rows : EMPTY_ROWS;
    const cashIn = summary?.scope === dashboardScopeKey ? Number(summary.receber) : 0;
    const cashOut = summary?.scope === dashboardScopeKey ? Number(summary.pagar) : 0;
    const flowRows = summary?.scope === dashboardScopeKey ? summary.flowRows : EMPTY_ROWS;
    const totalPaid = summary?.scope === dashboardScopeKey ? Number(summary.totalPaid) : 0;

    function displayValue(key: string, value: Row[string]) {
        if (key === "competencia") return competenceLabel(value) || "—";
        if (value === null || value === undefined || value === "") return "—";
        if (key.includes("_id")) {
            const source =
                key === "plano_conta_id"
                    ? "planos"
                    : key === "pessoa_id"
                    ? "pessoas"
                    : key === "banco_id"
                      ? "bancos"
                      : key === "lancamento_id"
                        ? "lancamentos"
                        : "formas";
            const record = [...(formLookups[source] || []), ...(lookups[source] || [])].find((item) => item.id === value);
            return record ? String(record.nome || record.descricao || "—") : String(value).slice(0, 8);
        }
        if (key === "valor" || key === "saldo") return currency(Number(value));
        if (key.startsWith("data_")) return date(value);
        if (typeof value === "boolean") return value ? "Sim" : "Não";
        if (key === "tipo")
            return (
                (
                    {
                        receber: "A receber",
                        pagar: "A pagar",
                        bancaria: "Bancária",
                        caixa: "Caixa",
                        dinheiro: "Dinheiro",
                        pix: "Pix",
                        debito: "Débito",
                        credito: "Crédito",
                        transferencia: "Transferência",
                        outro: "Outro",
                    } as Record<string, string>
                )[String(value)] || String(value)
            );
        return String(value);
    }

    return (
        <>
            <div className="app-shell">
                <aside inert={Boolean(modal)} id="main-navigation" className={`sidebar ${mobileNav ? "sidebar-open" : ""} ${companyMenu ? "company-menu-open" : ""}`}>
                    <div className="sidebar-brand">
                        <span className="brand-mark">
                            <Icon name="trend" size={20} />
                        </span>
                        <span>
                            Fluxo<span className="brand-dot">.</span>
                        </span>
                        <button className="mobile-close" aria-label="Fechar menu" onClick={() => setMobileNav(false)}>
                            <Icon name="close" />
                        </button>
                    </div>
                    <button className="company-switch" aria-label={"Selecionar empresa: " + company.nome} onClick={() => setCompanyMenu(!companyMenu)}>
                        <span className="company-avatar">{company.nome.slice(0, 1).toUpperCase()}</span>
                        <span className="company-info">
                            <b>{selectedCompanies.length > 1 ? `${selectedCompanies.length} empresas` : company.nome}</b>
                            <small>{company.perfil === "admin" ? "Plano essencial" : "Empresa"}</small>
                        </span>
                        <Icon name="chevron" size={16} />
                    </button>
                    {companyMenu && (
                        <div className="company-dropdown">
                            <p className="company-selection-hint">Marque as empresas que deseja visualizar. Mantenha ao menos uma selecionada.</p>
                            {companies.map(item => <label key={item.id} className="company-option">
                                <input type="checkbox" checked={selectedCompanyIds.includes(item.id)}
                                    disabled={selectedCompanyIds.length === 1 && selectedCompanyIds.includes(item.id)}
                                    onChange={() => changeCompany(item)} />
                                <span>{item.nome}{item.licenca_status === "vencida" && <small> · Licença vencida</small>}</span>
                            </label>)}
                           <button className="add-company" onClick={() => { setModal("company-edit"); setCompanyMenu(false); }}><Icon name="edit" size={16} /> Configurações da empresa</button>
                        </div>
                    )}
                    <nav className="nav-scroll">
                        {grouped.map((section) => (
                            <div className="nav-group" key={section}>
                                <span className="nav-label">{section}</span>
                                {nav
                                    .filter((item) => item.section === section)
                                    .map((item) => (
                                        <button
                                            key={item.key}
                                            aria-label={item.title} title={item.title}
                                            className={`nav-item ${page === item.key ? "active" : ""}`}
                                            onMouseEnter={() => preloadPage(item.key)}
                                            onFocus={() => preloadPage(item.key)}
                                            onClick={() => {
                                                navigate(item.key);
                                                setSearch("");
                                                setMobileNav(false);
                                            }}
                                        >
                                            <Icon name={item.icon} />
                                            <span>{item.title}</span>
                                            {item.key === "lancamentos" && overdue > 0 && (
                                                <i className="nav-count">{overdue}</i>
                                            )}
                                        </button>
                                    ))}
                            </div>
                        ))}
                    </nav>
                    <div className="sidebar-bottom">
                        {/*Em desenvolvimento, por isso hidden*/}
                        <div className="help-card">
                            <span className="help-graphic">✳</span>
                            <b>Precisa de uma mão?</b>
                            <small>Veja como organizar suas finanças.</small>
                            <button onClick={() => notify("Central de ajuda em breve.")}>
                                Acessar ajuda <span>↗</span>
                            </button>
                        </div>

                        <div className="profile-button">
                            <span className="user-avatar">
                                {(user.nome || user.email).slice(0, 1).toUpperCase()}
                            </span>
                            <span className="profile-info">
                                <b>{user.nome || user.email.split("@")[0]}</b>
                                <small>{user.email}</small>
                            </span>
                            <button className="logout-button" title="Sair" onClick={logout}>
                                <Icon name="logout" size={17} />
                            </button>
                        </div>
                    </div>
                </aside>
                {mobileNav && (
                    <button
                        className="nav-scrim"
                        onClick={() => setMobileNav(false)}
                        aria-label="Fechar navegação"
                    />
                )}
                <main className={`main-area ${["pessoas", "planos", "bancos", "formas"].includes(page) ? "bounded-list-area" : ""}`} inert={Boolean(modal)}>
                    <header className="topbar">
                        <div className="topbar-left">
                            <button
                                className="mobile-menu"
                                aria-label="Abrir navegação"
                                aria-expanded={mobileNav} aria-controls="main-navigation"
                                onClick={() => setMobileNav(true)}
                            >
                                <Icon name="menu" />
                            </button>
                            <div className="breadcrumbs">
                                <span>Fluxo</span>
                                <span className="crumb-sep">/</span>
                                <b>{resource?.title || "Visão geral"}</b>
                            </div>
                        </div>
                        <div className="topbar-actions">
                            {companyFilterControl}
                            <div className="zoom-controls" role="group" aria-label="Zoom da interface">
                                <button type="button" aria-label="Diminuir zoom" title="Diminuir zoom" disabled={zoom <= 80} onClick={() => setZoom(value => Math.max(80, value - 10))}>−</button>
                                <output aria-live="polite">{zoom}%</output>
                                <button type="button" aria-label="Aumentar zoom" title="Aumentar zoom" disabled={zoom >= 120} onClick={() => setZoom(value => Math.min(120, value + 10))}>+</button>
                            </div>
                            <span className="today-label">
                                <Icon name="calendar" size={16} />
                                {new Intl.DateTimeFormat("pt-BR", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                }).format(new Date())}
                            </span>
                            <div className="notification-anchor">
                                <button
                                    className="icon-button notification"
                                    title="Notificações"
                                    aria-expanded={notificationsOpen}
                                    onClick={() => setNotificationsOpen(!notificationsOpen)}
                                >
                                    <Icon name="bell" />
                                    {overdue > 0 && <i />}
                                </button>
                                {notificationsOpen && (
                                    <section className="notification-popover">
                                        <div className="notification-title">
                                            <b>Notificações</b>
                                            <button
                                                aria-label="Fechar notificações"
                                                onClick={() => setNotificationsOpen(false)}
                                            >
                                                <Icon name="close" size={16} />
                                            </button>
                                        </div>
                                        {overdueRows.length ? (
                                            <>
                                                <p className="notification-caption">
                                                    Contas vencidas que precisam de atenção
                                                </p>
                                                {overdueRows.slice(0, 5).map((item) => (
                                                    <button
                                                        className="notification-item"
                                                        key={String(item.empresa_id) + ":" + String(item.id)}
                                                        onClick={() => void openNotifiedAccount(item)}
                                                    >
                                                        <span
                                                            className={`notification-symbol ${item.tipo === "receber" ? "income-symbol" : "expense-symbol"}`}
                                                        >
                                                            <Icon
                                                                name={
                                                                    item.tipo === "receber"
                                                                        ? "arrowDown"
                                                                        : "arrowUp"
                                                                }
                                                                size={15}
                                                            />
                                                        </span>
                                                        <span>
                                                            <b>{String(item.descricao)}</b>
                                                            <small>
                                                                {item.tipo === "receber"
                                                                    ? "A receber"
                                                                    : "A pagar"}{" "}
                                                                · venceu em {date(item.data_vencimento)}
                                                            </small>
                                                        </span>
                                                        <span className="notification-value">
                                                            {currency(remainingAmount(item, dashboardData))}
                                                        </span>
                                                    </button>
                                                ))}
                                            </>
                                        ) : (
                                            <div className="notification-empty">
                                                <span>
                                                    <Icon name="check" />
                                                </span>
                                                <b>Tudo em dia</b>
                                                <small>Você não tem contas vencidas.</small>
                                            </div>
                                        )}
                                    </section>
                                )}
                            </div>
                            <span className="topbar-divider" />
                            <span className="topbar-user">
                                {(user.nome || user.email).slice(0, 1).toUpperCase()}
                            </span>
                        </div>
                    </header>
                    <div className={`page-content page-${page}`}>
                        {selectedCompanies.some(item => item.licenca_status === "vencida") && !selectedCompanies.every(item => item.licenca_status === "vencida") && <div className="inline-error" role="status">Dados indisponíveis por licença vencida: {selectedCompanies.filter(item => item.licenca_status === "vencida").map(item => item.nome).join(", ")}.</div>}
                        {loadError && <div className="inline-error" role="alert">{loadError} <button type="button" className="text-button" onClick={() => void reloadCurrent()}>Tentar novamente</button></div>}
                        <Suspense fallback={<section className="panel page-loading" role="status"><span className="spinner" /><span>Carregando página...</span></section>}>
                        {selectedCompanies.every(item => item.licenca_status === "vencida") ? (
                            <section className="panel license-expired"><span className="eyebrow muted">LICENÇA VENCIDA</span><h2>Esta empresa está com a licença expirada.</h2><p>Solicite a renovação a um administrador para voltar a utilizar os recursos financeiros.</p></section>
                        ) : page === "dashboard" ? (
                            <DashboardPage
                                year={dashboardYear}
                                onYearChange={setDashboardYear}
                                user={user}
                                rows={visibleRows}
                                flowRows={flowRows}
                                cashIn={cashIn}
                                cashOut={cashOut}
                                totalPaid={totalPaid}
                                overdue={overdue}
                                formatValue={displayValue}
                                onNavigate={navigate}
                                onCreate={(key) => {
                                    navigate(key);
                                    setModal("create");
                                }}
                            />
                        ) : page === "caixa" ? (
                            <CashPage
                                key={selectedCompanyIds.join(",") + ":" + companyFilter}
                                rows={cashRows as never}
                                initial={cashInitial}
                                meta={listMeta}
                                balance={cashInitial + (listResult?.key === filterKey ? listResult.balance : 0)}
                                onPageChange={next => setPagination({ key: filterKey, page: next })}
                                onInitialChange={setCashInitial}
                                onRefresh={reloadCurrent}
                            />
                        ) : resource ? (
                            <ResourcePage
                                key={company.id + resource.key}
                                resource={resource}
                                meta={listMeta}
                                sort={sort}
                                onSort={key => setSorting({ page, key, direction: sort.key === key && sort.direction === "asc" ? "desc" : "asc" })}
                                onPageChange={next => setPagination({ key: filterKey, page: next })}
                                loadOptions={loadFilterOptions}
                                visibleRows={filteredRows}
                                loading={Boolean(scopeKey) && (loading || (!loadError && listResult?.key !== filterKey))}
                                search={search}
                                formatValue={displayValue}
                                onSearch={setSearch}
                                dateFilters={dateFilters}
                                onDateFiltersChange={page === "baixas" ? setSettlementFilters : undefined}
                                personFilters={page === "pessoas" ? personFilters : undefined}
                                onPersonFiltersChange={page === "pessoas" ? setPersonFilters : undefined}
                                paymentForms={dashboardData.formas || []}
                                onCreate={tipo => {
                                    setSelectedRow(null);
                                    setModal("create", tipo);
                                }}
                                onEdit={(row) => {
                                    setSelectedRow(row);
                                    setModal("edit");
                                }}
                                onDelete={removeRow}
                                lancamentoFilters={page === "lancamentos" ? lancamentoFilters : undefined}
                                onLancamentoFiltersChange={
                                    page === "lancamentos" ? setLancamentoFilters : undefined
                                }
                                onShowSettlements={(row) => { setSelectedRow(row); setModal("details"); }}
                                hasSettlements={row => Number(row.quantidade_baixas || 0) > 0}
                                onSettle={(row) => {
                                    setSelectedRow(row);
                                    setModal("settle");
                                }}
                            />
                        ) : null}
                        </Suspense>
                    </div>
                </main>

                {modal && (
                    <div
                        className="modal-backdrop"
                        inert={settlementOverlay}
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) setModal(null);
                        }}
                    >
                        <section className={`modal-card ${modal === "settle" ? "settlement-modal" : ""} ${modal === "details" ? "account-modal" : ""} ${(modal === "create" || modal === "edit") && resource?.key === "lancamentos" ? modal === "edit" ? "account-new-modal account-edit-modal" : "account-new-modal" : ""}`} role="dialog" aria-modal="true" aria-label={modal === "details" ? "Detalhes das baixas" : "Cadastro"}>
                            <div className="modal-head">
                                <div>
                                    <span className="eyebrow muted">
                                        {modal === "company"
                                            ? "NOVA EMPRESA"
                                            : modal === "company-edit"
                                              ? "EDITAR EMPRESA"
                                              : modal === "details"
                                              ? "BAIXAS DA CONTA"
                                              : modal === "settle"
                                              ? "BAIXA DA CONTA"
                                              : modal === "edit"
                                                ? "EDITAR REGISTRO"
                                                : "NOVO CADASTRO"}
                                    </span>
                                    <h2>
                                        {modal === "company"
                                            ? "Cadastre sua empresa"
                                            : modal === "company-edit"
                                              ? "Configurações da empresa"
                                              : modal === "details"
                                              ? "Detalhes das baixas"
                                              : modal === "settle"
                                              ? selectedRow?.tipo === "receber"
                                                  ? "Registrar recebimento"
                                                  : "Registrar pagamento"
                                              : modal === "edit"
                                                ? `Editar ${resource?.singular}${resource?.key === "lancamentos" && currentAccount?.numero ? " nº " + currentAccount.numero : ""}`
                                                : resource?.key === "lancamentos" ? `Nova Conta${createAccountType === "receber" ? " a Receber" : createAccountType === "pagar" ? " a Pagar" : ""}`
                                                : `${resource?.key === "baixas" || resource?.key === "pessoas" ? "Nova" : "Novo"} ${resource?.singular}`}
                                    </h2>
                                </div>
                                {modal === "create" && resource?.key === "lancamentos" && <CompanySelect companies={selectedCompanies} visible={companies.length > 1}
                                    value={formCompanyId} onChange={id => { formVersion.current++; setFormCompany(id); }} form />}
                                <button className="icon-button" onClick={() => setModal(null)}>
                                    <Icon name="close" />
                                </button>
                            </div>
                            <Suspense fallback={<div className="table-loading" role="status"><span className="spinner" /> Carregando...</div>}>
                            {modal === "details" && currentAccount ? (
                                <div className="record-form">
                                    <p><b>{currentAccount.pessoa_id && <>{displayValue("pessoa_id", currentAccount.pessoa_id)} · </>}{String(currentAccount.descricao)}</b></p>
                                    <AccountSettlements reloadKey={detailsRevision} loadOptions={loadFormOptions} loadSettlements={loadAccountSettlements} account={currentAccount} data={dashboardData} busy={busy} formatValue={displayValue}
                                        onRemove={removeSettlement} onSettle={() => setSettlementOverlay(true)} />
                                </div>
                            ) : modal === "company-edit" ? (
                                <form onSubmit={updateCompany} className="record-form">
                                    <label className="form-field full-field">
                                        Nome da empresa
                                        <input
                                            name="nome"
                                            placeholder="Ex.: Aurora Studio"
                                            minLength={2}
                                            maxLength={200}
                                            required
                                            defaultValue={company.nome}
                                            autoFocus
                                        />
                                    </label>{user?.role === "admin" && <label className="form-field full-field">CPF/CNPJ <span className="optional-label">Opcional</span><input name="cnpj" inputMode="numeric" maxLength={14} placeholder="Somente números" pattern="[0-9]{11}([0-9]{3})?" defaultValue={company.cnpj || ""} /></label>}
                                    <label className="form-field full-field">
                                        Início da contabilização do caixa <span className="optional-label">Opcional</span>
                                        <input name="caixa_data_inicio" type="date" defaultValue={company.caixa_data_inicio || ""} />
                                        <small>O caixa considera somente baixas nesta data ou posteriores. Em branco, considera todo o histórico.</small>
                                    </label>
                                    <div className="modal-actions">
                                        <button
                                            type="button"
                                            className="button button-quiet"
                                            onClick={() => setModal(null)}
                                        >
                                            Cancelar
                                        </button>
                                        <button className="button button-primary" disabled={busy}>
                                            {busy && <span className="spinner" />} {modal === "company-edit" ? "Salvar alterações" : "Criar empresa"}{" "}
                                            <span>→</span>
                                        </button>
                                    </div>
                                </form>
                            ) : modal === "settle" && currentAccount ? (
                                <SettlementForm loadOptions={loadFormOptions} account={currentAccount} paymentForms={formLookups.formas || []} remaining={remainingAmount(currentAccount, dashboardData)}
                                    busy={busy} formatValue={displayValue} onSubmit={settleLaunch} onCancel={() => { setModal(null); setSelectedRow(null); }} />
                            ) : (
                                <div className={modal === "edit" && resource?.key === "lancamentos" ? "account-edit-layout" : undefined}>
                                <form onSubmit={saveRecord} className="record-form">
                                    {modal === "create" && resource?.key !== "lancamentos" && <CompanySelect companies={selectedCompanies} visible={companies.length > 1}
                                        value={formCompanyId} onChange={id => { formVersion.current++; setFormCompany(id); }} form />}
                                    {resource && (
                                        <RecordFormFields
                                            key={String(selectedRow?.id || resource.key) + modal}
                                            fields={resource.fields}
                                            onCreatePerson={createPerson}
                                            loadOptions={loadFormOptions}
                                            selectedRow={selectedRow}
                                            lookups={formLookups}
                                            companyId={formCompanyId}
                                            editing={modal === "edit"}
                                            fixedType={modal === "create" ? createAccountType : undefined}
                                        />
                                    )}
                                    <div className="modal-actions">
                                        <button
                                            type="button"
                                            className="button button-quiet"
                                            onClick={() => {
                                                setModal(null);
                                                setSelectedRow(null);
                                            }}
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            className="button button-primary"
                                            disabled={busy}
                                        >
                                            {busy && <span className="spinner" />}
                                            {modal === "edit" ? "Salvar alterações" : resource?.key === "lancamentos" ? "Gravar" : "Cadastrar"}{" "}
                                            <span>→</span>
                                        </button>
                                        {modal === "create" && resource?.key === "lancamentos" && <button type="submit" name="acao" value="gravar-baixa" className="button button-secondary" disabled={busy} title="Grava a conta e abre a baixa. No parcelamento, abre a primeira parcela.">
                                            <Icon name="check" size={18} /> Gravar + Baixa
                                        </button>}
                                    </div>
                                </form>
                                {modal === "edit" && resource?.key === "lancamentos" && currentAccount &&
                                    <AccountSettlements compact reloadKey={detailsRevision} loadOptions={loadFormOptions} loadSettlements={loadAccountSettlements} account={currentAccount} data={dashboardData} busy={busy} formatValue={displayValue}
                                        onRemove={removeSettlement} onSettle={() => setSettlementOverlay(true)} />}
                                </div>
                            )}
                            </Suspense>
                        </section>
                    </div>
                )}
                {settlementOverlay && currentAccount && <div className="modal-backdrop settlement-overlay" onMouseDown={event => {
                    if (event.target === event.currentTarget && !busy) setSettlementOverlay(false);
                }}>
                    <section className="modal-card settlement-modal" role="dialog" aria-modal="true" aria-label="Registrar baixa">
                        <div className="modal-head"><h2>{currentAccount.tipo === "receber" ? "Registrar recebimento" : "Registrar pagamento"}</h2>
                            <button type="button" className="icon-button" aria-label="Fechar baixa" autoFocus disabled={busy} onClick={() => setSettlementOverlay(false)}><Icon name="close" /></button>
                        </div>
                        <SettlementForm loadOptions={loadFormOptions} account={currentAccount} paymentForms={formLookups.formas || []} remaining={remainingAmount(currentAccount, dashboardData)}
                            busy={busy} formatValue={displayValue} onSubmit={settleLaunch} onCancel={() => setSettlementOverlay(false)} />
                    </section>
                </div>}
                {messageBox}
                {toast && (
                    <div className={`toast toast-${toast.type}`} role="status">
                        <span className="toast-check">
                            {toast.type === "success" ? <Icon name="check" size={15} /> : "!"}
                        </span>
                        {toast.message}
                        <button onClick={() => setToast(null)}>
                            <Icon name="close" size={16} />
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}

const warningDateFormatter = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });

function currency(value: number) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
        Number.isFinite(value) ? value : 0,
    );
}
function date(value: Row[string]) {
    if (!value) return "—";
    const raw = String(value);
    const day = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    const parsed = new Date(day ? `${day}T12:00:00` : raw);
    return Number.isNaN(parsed.getTime()) ? raw : new Intl.DateTimeFormat("pt-BR").format(parsed);
}

export default App;
