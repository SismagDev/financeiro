import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./components/Icon";
import { pageFromPath, pagePaths, resources } from "./data/resources";
import type { Company, Row, User } from "./types";
import "./App.css";
import { competenceDate, competenceLabel } from "./utils/dates";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000";
const EMPTY_ROWS: Row[] = [];
type Toast = { message: string; type: "success" | "error" };
const DashboardPage = lazy(() =>
    import("./pages/DashboardPage").then(({ DashboardPage }) => ({ default: DashboardPage })),
);
const CashPage = lazy(() => import("./pages/CashPage").then(({ CashPage }) => ({ default: CashPage })));
const ResourcePage = lazy(() =>
    import("./components/ResourcePage").then(({ ResourcePage }) => ({ default: ResourcePage })),
);
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
    const [companies, setCompanies] = useState<Company[]>([]);
    const [company, setCompany] = useState<Company | null>(null);
    const [page, setPage] = useState(() => pageFromPath(window.location.pathname));
    const [dashboardData, setDashboardData] = useState<Record<string, Row[]>>({});
    const [lookups, setLookups] = useState<Record<string, Row[]>>({});
    const [cashRows, setCashRows] = useState<Row[]>([]);
    const [cashInitial, setCashInitial] = useState(0);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [modal, setModal] = useState<"create" | "edit" | "company" | "company-edit" | "settle" | null>(null);
    const [selectedRow, setSelectedRow] = useState<Row | null>(null);
    const [search, setSearch] = useState("");
    const currentMonth = new Date();
    const [lancamentoFilters, setLancamentoFilters] = useState<{
        cliente: string;
        dataInicial: string;
        dataFinal: string;
        mostrarPagos: boolean;
        tipo: "todos" | "pagar" | "receber";
    }>(() => ({
        cliente: "",
        dataInicial: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1)
            .toISOString()
            .slice(0, 10),
        dataFinal: new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0)
            .toISOString()
            .slice(0, 10),
        mostrarPagos: false,
        tipo: "todos",
    }));
    const [toast, setToast] = useState<Toast | null>(null);
    const [mobileNav, setMobileNav] = useState(false);
    const [companyMenu, setCompanyMenu] = useState(false);
    const [notificationsOpen, setNotificationsOpen] = useState(false);

    function navigate(next: string) {
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

    const loadCompanies = useCallback(async () => {
        const result = await api("/empresas");
        const list: Company[] = result.data || [];
        setCompanies(list);
        const saved = localStorage.getItem("fluxo-company");
        const chosen = list.find((item) => item.id === saved) || list[0] || null;
        setCompany(chosen);
        if (chosen) localStorage.setItem("fluxo-company", chosen.id);
        else localStorage.removeItem("fluxo-company");
        setLoading(false);
        return chosen;
    }, []);

    useEffect(() => {
        api("/auth/me")
            .then((result) => {                setUser(result.data);
                setAuthChecked(true);
                if (result.data.role === "admin") { setLoading(false); return; }
                return loadCompanies();
            })
            .catch(() => {
                setUser(null);
                setLoading(false);
                setAuthChecked(true);
            });
    }, [loadCompanies]);

    useEffect(() => {
        if (!user) return;
        if (!companies.length) return;
        if (!company) return;
        if (company.licenca_status === "vencida") return;
        const endpoints = resources.map((item) =>
            api(item.endpoint, {}, company.id)
                .then((result: { data: Row[] }) => [item.key, result.data] as const)
                .catch(() => [item.key, []] as const),
        );
        Promise.all([
            ...endpoints,
            api(`/caixa?saldo_inicial=${cashInitial}`, {}, company.id).catch(() => ({ data: [] })),
        ]).then((results) => {
            const cash = results.pop() as { data: Row[] } | undefined;
            const data = Object.fromEntries(results);
            setDashboardData(data);
            setLookups(data);
            setCashRows(cash?.data || []);
            setLoading(false);
        });
    }, [user, company, companies.length, page, cashInitial]);

    const resource = resources.find((item) => item.key === page);
    const currentRows = dashboardData[page] || EMPTY_ROWS;
    const filteredRows = useMemo(
        () =>
            currentRows.filter((row) => {
                if (!JSON.stringify(row).toLowerCase().includes(search.toLowerCase())) return false;
                if (page !== "lancamentos") return true;
                const pessoa = (lookups.pessoas || []).find((item) => item.id === row.pessoa_id);
                const cliente = String(pessoa?.nome || "").toLowerCase();
                const vencimento = String(row.data_vencimento || "").slice(0, 10);
                return (
                    (lancamentoFilters.tipo === "todos" || row.tipo === lancamentoFilters.tipo) &&
                    (lancamentoFilters.mostrarPagos || row.status !== "pago") &&
                    (!lancamentoFilters.cliente ||
                        cliente.includes(lancamentoFilters.cliente.toLowerCase())) &&
                    (!lancamentoFilters.dataInicial || vencimento >= lancamentoFilters.dataInicial) &&
                    (!lancamentoFilters.dataFinal || vencimento <= lancamentoFilters.dataFinal)
                );
            }),
        [currentRows, search, page, lookups.pessoas, lancamentoFilters],
    );
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
            await loadCompanies();
        } catch {
            setCompanies([]);
            setCompany(null);
        }
        setLoading(false);
    }
    async function logout() {
        try {
            await api("/auth/logout", { method: "POST" });
        } finally {
            setUser(null);
            setCompany(null);
            setCompanies([]);
            localStorage.removeItem("fluxo-company");
        }
    }
    async function changeCompany(next: Company) {
        setCompany(next);
        localStorage.setItem("fluxo-company", next.id);
        setCompanyMenu(false);
        if (next.licenca_status === "vencida") notify("A licença desta empresa expirou.", "error");
        navigate("dashboard");
    }

    async function saveRecord(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!company || !resource) return;
        setBusy(true);
        const form = new FormData(event.currentTarget);
        const darBaixa = modal !== "edit" && resource.key === "lancamentos" && Boolean(form.get("forma_pagamento_id"));
        const payload: Row = {};
        for (const field of resource.fields) {
            const value = form.get(field.name);
            if (field.type === "checkbox") payload[field.name] = value === "on";
            else if (field.name === "competencia" && typeof value === "string") payload[field.name] = competenceDate(value);
            else if ((field.name === "plano_conta_id" || field.name === "pessoa_id") && value === "" && modal === "edit") payload[field.name] = null;
            else if (typeof value === "string" && value !== "")
                payload[field.name] = field.type === "number" ? Number(value) : value;
        }
        try {
            const editing = modal === "edit" && selectedRow?.id;
            const parcelas = Number(payload.parcelas || 1);
            const modoValor = String(form.get("modo_valor") || "total");
            const detalharParcelamento = form.get("detalhar_parcelamento") === "on";
            const intervalos = String(form.get("intervalos") || "")
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isInteger(item) && item > 0);
            delete payload.parcelas;
            const endpoint =
                !editing && resource.key === "lancamentos" && parcelas > 1
                    ? "/lancamentos/parcelado"
                    : `${resource.endpoint}${editing ? `/${selectedRow.id}` : ""}`;
            await api(
                endpoint,
                {
                    method: editing ? "PATCH" : "POST",
                    body: JSON.stringify({
                        ...payload,
                        ...(darBaixa ? { forma_pagamento_id: form.get("forma_pagamento_id") } : {}),
                        ...(!editing && resource.key === "lancamentos" && parcelas > 1
                            ? {
                                  parcelas,
                                  modo_valor: modoValor,
                                  ...(detalharParcelamento ? { intervalos } : {}),
                              }
                            : {}),
                    }),
                },
                company.id,
            );
            notify(
                editing
                    ? "Alterações salvas."
                    : parcelas > 1 && resource.key === "lancamentos"
                      ? `${parcelas} parcelas criadas.`
                      : `${resource.singular[0].toUpperCase()}${resource.singular.slice(1)} cadastrado${resource.key === "pessoas" ? "a" : ""}.`,
            );
            setModal(null);
            setSelectedRow(null);
            await reloadCurrent();
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível salvar.", "error");
        } finally {
            setBusy(false);
        }
    }

    function remainingAmount(row: Row) {
        const records =
            row.tipo === "receber" ? dashboardData.recebimentos || [] : dashboardData.movimentacoes || [];
        const settled = records
            .filter((item) => item.lancamento_id === row.id)
            .reduce((sum, item) => sum + Number(item.valor || 0), 0);
        return Math.max(0, Math.round((Number(row.valor || 0) - settled) * 100) / 100);
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
                    }),
                },
                company.id,
            );
            setModal(null);
            setSelectedRow(null);
            await reloadCurrent();
            notify("Baixa registrada e status atualizado.");
        } catch (e) {
            notify(e instanceof Error ? e.message : "Não foi possível registrar a baixa.", "error");
        } finally {
            setBusy(false);
        }
    }

    async function reloadCurrent() {
        if (!company) return;
        const results = await Promise.all(
            resources.map((item) =>
                api(item.endpoint, {}, company.id)
                    .then((result: { data: Row[] }) => [item.key, result.data] as const)
                    .catch(() => [item.key, []] as const),
            ),
        );
        const data = Object.fromEntries(results);
        setDashboardData(data);
        setLookups(data);
        const cash = await api(`/caixa?saldo_inicial=${cashInitial}`, {}, company.id).catch(() => ({
            data: [],
        }));
        setCashRows(cash.data || []);
    }

    async function createPerson(values: Row): Promise<Row> {
        if (!company) throw new Error("Selecione uma empresa.");
        const result = await api("/pessoas", { method: "POST", body: JSON.stringify(values) }, company.id);
        const row = { ...values, id: result.id };
        setLookups(current => ({ ...current, pessoas: [...(current.pessoas || []), row] }));
        setDashboardData(current => ({ ...current, pessoas: [...(current.pessoas || []), row] }));
        return row;
    }

    async function removeRow(row: Row) {
        if (!company || !resource || !window.confirm(`Excluir este registro de ${resource.singular}?`))
            return;
        try {
            await api(`${resource.endpoint}/${row.id}`, { method: "DELETE" }, company.id);
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
                body: JSON.stringify({ nome: values.nome, ...(user?.role === "admin" ? { cnpj: values.cnpj || null } : {}) }),
            });
            await loadCompanies();
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
    const nav = [
        { key: "dashboard", title: "Visão geral", icon: "grid", section: "WORKSPACE" },
        { key: "lancamentos", title: "Lançamentos", icon: "arrows", section: "FINANCEIRO" },
        { key: "pessoas", title: "Pessoas", icon: "users", section: "CADASTROS" },
        { key: "caixa", title: "Gestão de caixa", icon: "wallet", section: "FINANCEIRO" },
        { key: "formas", title: "Formas de pagamento", icon: "card", section: "CADASTROS" },
        { key: "bancos", title: "Bancos", icon: "bank", section: "CADASTROS" },
        { key: "planos", title: "Planos de contas", icon: "grid", section: "CADASTROS" },
        { key: "movimentacoes", title: "Movimentações", icon: "arrowDown", section: "FINANCEIRO" },
        { key: "recebimentos", title: "Recebimentos", icon: "arrowUp", section: "FINANCEIRO" },
    ];
    const grouped = ["WORKSPACE", "FINANCEIRO", "CADASTROS"];
    const visibleRows = dashboardData.lancamentos || [];
    const cashIn = visibleRows
        .filter((item) => item.tipo === "receber" && item.status !== "cancelado" && item.status !== "pago")
        .reduce((sum, item) => sum + remainingAmount(item), 0);
    const cashOut = visibleRows
        .filter((item) => item.tipo === "pagar" && item.status !== "cancelado" && item.status !== "pago")
        .reduce((sum, item) => sum + remainingAmount(item), 0);
    const overdue = visibleRows.filter(
        (item) =>
            item.status === "pendente" &&
            String(item.data_vencimento || "").slice(0, 10) < new Date().toISOString().slice(0, 10),
    ).length;
    const overdueRows = visibleRows.filter(
        (item) =>
            item.status === "pendente" &&
            String(item.data_vencimento || "").slice(0, 10) < new Date().toISOString().slice(0, 10),
    );
    const flowRows = [
        ...(dashboardData.recebimentos || []).map((item) => ({
            ...item,
            tipo: "receber",
            data_fluxo: item.data_recebimento,
        })),
        ...(dashboardData.movimentacoes || []).map((item) => ({
            ...item,
            tipo: "pagar",
            data_fluxo: item.data_movimentacao,
        })),
    ];
    const totalPaid = [...(dashboardData.recebimentos || []), ...(dashboardData.movimentacoes || [])].reduce(
        (sum, item) => sum + Number(item.valor || 0),
        0,
    );

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
            const record = (lookups[source] || []).find((item) => item.id === value);
            return record ? String(record.nome || record.descricao || "—") : String(value).slice(0, 8);
        }
        if (key === "valor") return currency(Number(value));
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
        <Suspense
            fallback={
                <div className="full-loader">
                    <span className="spinner spinner-large" />
                    <span>Carregando área interna...</span>
                </div>
            }
        >
            <div className="app-shell">
                <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
                    <div className="sidebar-brand">
                        <span className="brand-mark">
                            <Icon name="trend" size={20} />
                        </span>
                        <span>
                            Fluxo<span className="brand-dot">.</span>
                        </span>
                        <button className="mobile-close" onClick={() => setMobileNav(false)}>
                            <Icon name="close" />
                        </button>
                    </div>
                    <button className="company-switch" onClick={() => setCompanyMenu(!companyMenu)}>
                        <span className="company-avatar">{company.nome.slice(0, 1).toUpperCase()}</span>
                        <span className="company-info">
                            <b>{company.nome}</b>
                            <small>{company.perfil === "admin" ? "Plano essencial" : "Empresa"}</small>
                        </span>
                        <Icon name="chevron" size={16} />
                    </button>
                    {companyMenu && (
                        <div className="company-dropdown">
                            {companies.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => changeCompany(item)}
                                    className={
                                        item.id === company.id ? "company-option current" : "company-option"
                                    }
                                >
                                    <span className="company-avatar small">{item.nome.slice(0, 1)}</span>
                                    {item.nome}
                                    {item.id === company.id && <Icon name="check" size={16} />}
                                </button>
                            ))}                            <button className="add-company" onClick={() => { setModal("company-edit"); setCompanyMenu(false); }}><Icon name="edit" size={16} /> Editar empresa</button>
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
                                            className={`nav-item ${page === item.key ? "active" : ""}`}
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
                <main className="main-area">
                    <header className="topbar">
                        <div className="topbar-left">
                            <button
                                className="mobile-menu"
                                aria-label="Abrir navegação"
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
                                                    Lançamentos vencidos que precisam de atenção
                                                </p>
                                                {overdueRows.slice(0, 5).map((item) => (
                                                    <button
                                                        className="notification-item"
                                                        key={String(item.id)}
                                                        onClick={() => {
                                                            navigate("lancamentos");
                                                            setNotificationsOpen(false);
                                                        }}
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
                                                            {currency(Number(item.valor || 0))}
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
                                                <small>Você não tem lançamentos vencidos.</small>
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
                    <div className="page-content">
                        {company.licenca_status === "vencida" ? (
                            <section className="panel license-expired"><span className="eyebrow muted">LICENÇA VENCIDA</span><h2>Esta empresa está com a licença expirada.</h2><p>Solicite a renovação a um administrador para voltar a utilizar os recursos financeiros.</p></section>
                        ) : page === "dashboard" ? (
                            <DashboardPage
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
                                rows={cashRows as never}
                                initial={cashInitial}
                                onInitialChange={setCashInitial}
                                onRefresh={reloadCurrent}
                            />
                        ) : resource ? (
                            <ResourcePage
                                resource={resource}
                                company={company}
                                rows={currentRows}
                                visibleRows={filteredRows}
                                loading={loading}
                                search={search}
                                formatValue={displayValue}
                                onSearch={setSearch}
                                onCreate={() => {
                                    setSelectedRow(null);
                                    setModal("create");
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
                                onSettle={(row) => {
                                    setSelectedRow(row);
                                    setModal("settle");
                                }}
                            />
                        ) : null}
                    </div>
                </main>

                {modal && (
                    <div
                        className="modal-backdrop"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) setModal(null);
                        }}
                    >
                        <section className="modal-card">
                            <div className="modal-head">
                                <div>
                                    <span className="eyebrow muted">
                                        {modal === "company"
                                            ? "NOVA EMPRESA"
                                            : modal === "company-edit"
                                              ? "EDITAR EMPRESA"
                                              : modal === "settle"
                                              ? "BAIXA DO LANÇAMENTO"
                                              : modal === "edit"
                                                ? "EDITAR REGISTRO"
                                                : "NOVO CADASTRO"}
                                    </span>
                                    <h2>
                                        {modal === "company"
                                            ? "Cadastre sua empresa"
                                            : modal === "company-edit"
                                              ? "Editar empresa"
                                              : modal === "settle"
                                              ? selectedRow?.tipo === "receber"
                                                  ? "Registrar recebimento"
                                                  : "Registrar pagamento"
                                              : modal === "edit"
                                                ? `Editar ${resource?.singular}`
                                                : `Novo ${resource?.singular}`}
                                    </h2>
                                </div>
                                <button className="icon-button" onClick={() => setModal(null)}>
                                    <Icon name="close" />
                                </button>
                            </div>
                            <Suspense fallback={<div className="table-loading" role="status"><span className="spinner" /> Carregando...</div>}>
                            {modal === "company-edit" ? (
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
                            ) : modal === "settle" && selectedRow ? (
                                <form onSubmit={settleLaunch} className="record-form">
                                    <div
                                        className={`settle-summary ${selectedRow.tipo === "receber" ? "income-settle" : "expense-settle"}`}
                                    >
                                        <span>
                                            {selectedRow.tipo === "receber" ? "Recebimento" : "Pagamento"} ·{" "}
                                            {String(selectedRow.descricao)}
                                        </span>
                                        <b>Saldo em aberto: {currency(remainingAmount(selectedRow))}</b>
                                    </div>
                                    <div className="form-grid">
                                        <label className="form-field full-field">
                                            Forma de pagamento
                                            <select name="forma_pagamento_id" required defaultValue="">
                                                <option value="">Selecione uma forma de pagamento</option>
                                                {(lookups.formas || [])
                                                    .filter((item) => item.ativo !== false)
                                                    .map((item) => (
                                                        <option key={String(item.id)} value={String(item.id)}>
                                                            {String(item.descricao)}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                        <label className="form-field">
                                            Valor da baixa
                                            <input
                                                name="valor"
                                                type="number"
                                                min="0.01"
                                                max={remainingAmount(selectedRow)}
                                                step="0.01"
                                                required
                                                defaultValue={remainingAmount(selectedRow).toFixed(2)}
                                            />
                                        </label>
                                        <label className="form-field">
                                            Data
                                            <input
                                                name="data"
                                                type="date"
                                                defaultValue={new Date().toISOString().slice(0, 10)}
                                            />
                                        </label>
                                    </div>
                                    <p className="settle-hint">
                                        Você pode informar o valor total ou fazer uma baixa parcial.
                                    </p>
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
                                        <button className="button button-primary" disabled={busy}>
                                            {busy && <span className="spinner" />} Confirmar baixa{" "}
                                            <span>→</span>
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <form onSubmit={saveRecord} className="record-form">
                                    {resource && (
                                        <RecordFormFields
                                            key={String(selectedRow?.id || resource.key) + modal}
                                            fields={resource.fields}
                                            onCreatePerson={createPerson}
                                            selectedRow={selectedRow}
                                            lookups={lookups}
                                            editing={modal === "edit"}
                                        />
                                    )}
                                    {!selectedRow && resource?.key === "lancamentos" && (
                                        <label className="form-field full-field immediate-settlement">
                                            <span>
                                                Forma para baixa imediata{" "}
                                                <span className="optional-label">Opcional</span>
                                            </span>
                                            <select name="forma_pagamento_id" defaultValue="">
                                                <option value="">Selecione para cadastrar e dar baixa</option>
                                                {(lookups.formas || [])
                                                    .filter((item) => item.ativo !== false)
                                                    .map((item) => (
                                                        <option key={String(item.id)} value={String(item.id)}>
                                                            {String(item.descricao)}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
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
                                            {modal === "edit" ? "Salvar alterações" : "Cadastrar"}{" "}
                                            <span>→</span>
                                        </button>

                                    </div>
                                </form>
                            )}
                            </Suspense>
                        </section>
                    </div>
                )}
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
        </Suspense>
    );
}

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
