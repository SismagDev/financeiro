import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import type { User } from "../types";

type AdminUser = {
    id: string;
    nome: string;
    email: string;
    role: "admin" | "contador" | "comum";
    ativo: boolean;
    created_at: string;
};
type Company = {
    id: string;
    nome: string;
    cnpj: string | null;
    ativo: boolean;
    licenca_expira_em: string | null;
    licenca_status: "ativa" | "vencida";
};
type Request = (path: string, options?: RequestInit) => Promise<{ data: never[] }>;
type Props = { user: User; request: Request; onLogout: () => void };
const dateInput = (value: string | null) => value?.slice(0, 10) || "";
const formatDate = (value: string | null) =>
    value ? new Intl.DateTimeFormat("pt-BR").format(new Date(value)) : "Não definida";

export function AdminPage({ user, request, onLogout }: Props) {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [companyId, setCompanyId] = useState("");
    const [companyUsers, setCompanyUsers] = useState<AdminUser[]>([]);
    const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
    const [creatingUser, setCreatingUser] = useState(false);
    const [editingCompany, setEditingCompany] = useState<Company | null>(null);
    const [creatingCompany, setCreatingCompany] = useState(false);
    const [linkUserId, setLinkUserId] = useState("");
    const [licenseDate, setLicenseDate] = useState("");
    const [userSearch, setUserSearch] = useState("");
    const [companySearch, setCompanySearch] = useState("");
    const [error, setError] = useState("");
    const load = useCallback(async () => {
        const [usersResult, companiesResult] = await Promise.all([
            request("/admin/users"),
            request("/admin/companies"),
        ]);
        setUsers(usersResult.data as AdminUser[]);
        setCompanies(companiesResult.data as Company[]);
    }, [request]);
    const loadCompanyUsers = useCallback(async () => {
        if (!companyId) return;
        const result = await request(`/admin/companies/${companyId}/users`);
        setCompanyUsers(result.data as AdminUser[]);
    }, [companyId, request]);
    useEffect(() => {
        void (async () => {
            try {
                await load();
            } catch {
                setError("Não foi possível carregar o painel administrativo.");
            }
        })();
    }, [load]);
    useEffect(() => {
        void (async () => {
            try {
                await loadCompanyUsers();
            } catch {
                setError("Não foi possível carregar os usuários da empresa.");
            }
        })();
    }, [loadCompanyUsers]);
    const selectedCompany = companies.find((item) => item.id === companyId);
    const visibleUsers = users.filter((item) => item.nome.toLowerCase().includes(userSearch.toLowerCase()));
    const visibleCompanies = companies.filter((item) =>
        item.nome.toLowerCase().includes(companySearch.toLowerCase()),
    );
    async function saveUser(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const payload = {
            nome: values.nome,
            email: values.email,
            role: values.role,
            ...(values.password ? { password: values.password } : {}),
        };
        try {
            if (editingUser)
                await request(`/admin/users/${editingUser.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
            else
                await request("/admin/users", {
                    method: "POST",
                    body: JSON.stringify({ ...payload, password: values.password }),
                });
            setEditingUser(null);
            setCreatingUser(false);
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível salvar o usuário.");
        }
    }
    async function saveCompany(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        const values = Object.fromEntries(new FormData(event.currentTarget));
        const payload = { nome: values.nome, cnpj: values.cnpj || null };
        try {
            if (editingCompany)
                await request(`/admin/companies/${editingCompany.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload),
                });
            else await request("/admin/companies", { method: "POST", body: JSON.stringify(payload) });
            setEditingCompany(null);
            setCreatingCompany(false);
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível salvar a empresa.");
        }
    }
    async function saveLicense(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!companyId || !licenseDate) return;
        setError("");
        try {
            await request(`/admin/companies/${companyId}/license`, {
                method: "PATCH",
                body: JSON.stringify({ licenca_expira_em: licenseDate }),
            });
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível renovar a licença.");
        }
    }
    async function toggleCompany(item: Company) {
        try {
            await request(`/admin/companies/${item.id}/status`, {
                method: "PATCH",
                body: JSON.stringify({ ativo: !item.ativo }),
            });
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível atualizar a empresa.");
        }
    }
    async function toggleUser(item: AdminUser) {
        try {
            await request(`/admin/users/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify({ ativo: !item.ativo }),
            });
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível atualizar o usuário.");
        }
    }
    async function removeUser(item: AdminUser) {
        if (!window.confirm(`Excluir o usuário ${item.nome}?`)) return;
        try {
            await request(`/admin/users/${item.id}`, { method: "DELETE" });
            await load();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível excluir o usuário.");
        }
    }
    async function linkUser() {
        if (!companyId || !linkUserId) return;
        try {
            await request(`/admin/companies/${companyId}/users`, {
                method: "POST",
                body: JSON.stringify({ userId: linkUserId, perfil: "comum" }),
            });
            setLinkUserId("");
            await loadCompanyUsers();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível vincular o usuário.");
        }
    }
    async function unlinkUser(item: AdminUser) {
        if (!companyId) return;
        try {
            await request(`/admin/companies/${companyId}/users/${item.id}`, { method: "DELETE" });
            await loadCompanyUsers();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Não foi possível remover o vínculo.");
        }
    }
    return (
        <main className="admin-page">
            <header className="admin-header">
                <div>
                    <span className="eyebrow muted">ADMINISTRAÇÃO</span>
                    <h1>Painel Administrativo</h1>
                    <p>Gerencie usuários, empresas e licenças.</p>
                </div>
                <div>
                    <span className="admin-user">{user.nome || user.email}</span>
                    <button className="button button-quiet" onClick={onLogout}>
                        Sair
                    </button>
                </div>
            </header>
            {error && <div className="inline-error">{error}</div>}
            <section className="panel admin-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Usuários</h2>
                        <p>Crie, edite e controle o acesso dos usuários.</p>
                    </div>
                    <button
                        className="button button-primary"
                        onClick={() => {
                            setCreatingUser(true);
                            setEditingUser(null);
                        }}
                    >
                        <Icon name="plus" size={16} /> Novo usuário
                    </button>
                </div>
                {(creatingUser || editingUser) && (
                    <form className="admin-user-form" onSubmit={saveUser}>
                        <label>
                            Nome
                            <input name="nome" defaultValue={editingUser?.nome} required minLength={2} />
                        </label>
                        <label>
                            E-mail
                            <input name="email" type="email" defaultValue={editingUser?.email} required />
                        </label>
                        <label>
                            Perfil
                            <select name="role" defaultValue={editingUser?.role || "comum"}>
                                <option value="comum">Comum</option>
                                <option value="contador">Contador</option>
                                <option value="admin">Administrador</option>
                            </select>
                        </label>
                        <label>
                            Senha
                            <input
                                name="password"
                                type="password"
                                minLength={6}
                                required={!editingUser}
                                placeholder={
                                    editingUser ? "Deixe em branco para manter" : "Mínimo de 6 caracteres"
                                }
                            />
                        </label>
                        <button className="button button-primary">Salvar</button>
                        <button
                            type="button"
                            className="button button-quiet"
                            onClick={() => {
                                setCreatingUser(false);
                                setEditingUser(null);
                            }}
                        >
                            Cancelar
                        </button>
                    </form>
                )}
                {!creatingUser && (
                    <input
                        className="admin-search"
                        placeholder="Buscar usuário por nome"
                        value={userSearch}
                        onChange={(event) => setUserSearch(event.target.value)}
                    />
                )}
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>E-mail</th>
                                <th>Perfil</th>
                                <th>Status</th>
                                <th className="action-head" />
                            </tr>
                        </thead>
                        <tbody>
                            {visibleUsers.map((item) => (
                                <tr key={item.id}>
                                    <td>
                                        <b>{item.nome}</b>
                                    </td>
                                    <td>{item.email}</td>
                                    <td>{item.role}</td>
                                    <td>{item.ativo ? "Ativo" : "Inativo"}</td>
                                    <td className="row-actions">
                                        <button
                                            title="Editar"
                                            onClick={() => {
                                                setEditingUser(item);
                                                setCreatingUser(false);
                                            }}
                                        >
                                            <Icon name="edit" size={16} />
                                        </button>
                                        <button
                                            title={item.ativo ? "Inativar" : "Ativar"}
                                            onClick={() => void toggleUser(item)}
                                        >
                                            <Icon name={item.ativo ? "close" : "check"} size={16} />
                                        </button>
                                        <button
                                            title={
                                                item.id === user.id
                                                    ? "Não é possível excluir o próprio usuário"
                                                    : "Excluir"
                                            }
                                            disabled={item.id === user.id}
                                            onClick={() => void removeUser(item)}
                                        >
                                            <Icon name="trash" size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
            <section className="panel admin-panel">
                <div className="panel-heading">
                    <div>
                        <h2>Empresas</h2>
                        <p>Cadastre empresas, licenças e seus vínculos.</p>
                    </div>
                    <button
                        className="button button-primary"
                        onClick={() => {
                            setCreatingCompany(true);
                            setEditingCompany(null);
                        }}
                    >
                        <Icon name="plus" size={16} /> Nova empresa
                    </button>
                </div>
                {(creatingCompany || editingCompany) && (
                    <form className="admin-company-form" onSubmit={saveCompany}>
                        <label>
                            Nome
                            <input name="nome" defaultValue={editingCompany?.nome} required minLength={2} />
                        </label>
                        <label>
                            CPF/CNPJ
                            <input
                                name="cnpj"
                                inputMode="numeric"
                                pattern="\d{11}(\d{3})?"
                                defaultValue={editingCompany?.cnpj || ""}
                            />
                        </label>
                        <button className="button button-primary">Salvar</button>
                        <button
                            type="button"
                            className="button button-quiet"
                            onClick={() => {
                                setCreatingCompany(false);
                                setEditingCompany(null);
                            }}
                        >
                            Cancelar
                        </button>
                    </form>
                )}
                {!(creatingCompany || editingCompany) && (
                    <input
                        className="admin-search"
                        placeholder="Buscar empresa por nome"
                        value={companySearch}
                        onChange={(event) => setCompanySearch(event.target.value)}
                    />
                )}
                <div className="table-wrap">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Empresa</th>
                                <th>CPF/CNPJ</th>
                                <th>Licença</th>
                                <th>Vencimento</th>
                                <th>Status</th>
                                <th className="action-head" />
                            </tr>
                        </thead>
                        <tbody>
                            {visibleCompanies.map((item) => (
                                <tr
                                    key={item.id}
                                    className={`${item.id === companyId ? "selected-company" : ""} ${!item.ativo ? "inactive-company" : ""}`}
                                    onClick={() => {
                                        setCompanyId(item.id);
                                        setLicenseDate(dateInput(item.licenca_expira_em));
                                    }}
                                >
                                    <td>
                                        <b>{item.nome}</b>
                                    </td>
                                    <td>{item.cnpj || "—"}</td>
                                    <td>{item.licenca_status === "ativa" ? "Ativa" : "Vencida"}</td>
                                    <td>{formatDate(item.licenca_expira_em)}</td>
                                    <td>{item.ativo ? "Ativa" : "Inativa"}</td>
                                    <td className="row-actions">
                                        <button
                                            title="Editar empresa"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setEditingCompany(item);
                                                setCreatingCompany(false);
                                            }}
                                        >
                                            <Icon name="edit" size={16} />
                                        </button>
                                        <button
                                            title={item.ativo ? "Inativar empresa" : "Ativar empresa"}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void toggleCompany(item);
                                            }}
                                        >
                                            <Icon name={item.ativo ? "close" : "check"} size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {selectedCompany && (
                    <div className="admin-company-users">
                        <b>{selectedCompany.nome}</b>
                        <form className="admin-license-form" onSubmit={saveLicense}>
                            <label>
                                Vencimento da licença
                                <input
                                    type="date"
                                    value={licenseDate}
                                    onChange={(event) => setLicenseDate(event.target.value)}
                                    required
                                />
                            </label>
                            <button className="button button-primary">Salvar licença</button>
                            <span>
                                Licença
                                {selectedCompany.licenca_status === "ativa" ? " ativa" : " vencida"}
                                <br />
                                {formatDate(selectedCompany.licenca_expira_em)}
                            </span>
                        </form>
                        <b>Usuários vinculados</b>
                        <div className="admin-link-user">
                            <select
                                value={linkUserId}
                                onChange={(event) => setLinkUserId(event.target.value)}
                            >
                                <option value="">Vincular usuário</option>
                                {users
                                    .filter(
                                        (item) =>
                                            item.role !== "admin" &&
                                            !companyUsers.some((linked) => linked.id === item.id),
                                    )
                                    .map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.nome} · {item.email}
                                        </option>
                                    ))}
                            </select>
                            <button
                                className="button button-primary "
                                onClick={() => void linkUser()}
                                disabled={!linkUserId}
                            >
                                Vincular
                            </button>
                        </div>
                        {companyUsers.length ? (
                            <ul>
                                {companyUsers.map((item) => (
                                    <li key={item.id}>
                                        {item.nome} · {item.email} · {item.ativo ? "Ativo" : "Inativo"}
                                        <button className="link-button" onClick={() => void unlinkUser(item)}>
                                            Remover vínculo
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p>Nenhum usuário vinculado.</p>
                        )}
                    </div>
                )}
            </section>
        </main>
    );
}
