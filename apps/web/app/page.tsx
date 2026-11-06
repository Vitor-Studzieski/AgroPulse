"use client";

import dynamic from "next/dynamic";
import { FormEvent, Fragment, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Alert, AlertRule, apiBlob, apiFetch, apiUrl, ApiError, detailOf, entityId, Farm, Field, Operation, OperationAttachment, Reading, Season, Sensor, SeriesPoint, User } from "@/lib/api";
import { OperationDialog, operationTypeLabel, SeasonDialog, seasonStatusLabel, SensorDialog } from "@/components/record-dialogs";
import { AccountDialog, AccountUpdate } from "@/components/account-dialog";
import { ProductionRankingPanel, WeatherPanel } from "@/components/insights-panels";
import { IrrigationResponsePanel } from "@/components/irrigation-response";
import { FieldIntelligence } from "@/components/field-intelligence";
import { useDialogAccessibility } from "@/components/use-dialog-accessibility";
import { locateSensors } from "@/lib/geo";

const FieldMap = dynamic(() => import("@/components/leaflet-map"), { ssr: false, loading: () => <div className="map-frame map-loading"><span className="skeleton"/>Carregando mapa…</div> });
const TelemetryChart = dynamic(() => import("@/components/telemetry-chart"), { ssr: false, loading: () => <div className="chart-loading"><span className="skeleton"/>Carregando gráfico…</div> });

type Page = "overview" | "farms" | "fields" | "seasons" | "operations" | "insights" | "sensors" | "alerts";
type ApiConnectionState = "connecting" | "online" | "offline";
type FarmModal = { mode: "create" | "edit"; farm?: Farm } | null;
type FieldModal = { mode: "create" | "edit"; field?: Field } | null;
type RecordModal<T> = { mode: "create" } | { mode: "edit"; record: T } | null;
type Notice = { kind: "success" | "error"; text: string };

const pageTitles: Record<Page, string> = {
  overview: "Visão geral", farms: "Fazendas", fields: "Talhões", seasons: "Safras",
  operations: "Operações", insights: "Inteligência de campo", sensors: "Sensores", alerts: "Alertas",
};
const pageKeys = new Set<Page>(["overview", "farms", "fields", "seasons", "operations", "insights", "sensors", "alerts"]);

const crops: Record<Field["crop"], string> = {
  soja: "Soja",
  milho: "Milho",
  cana: "Cana-de-açúcar",
  cafe: "Café",
  trigo: "Trigo",
  algodao: "Algodão",
};
const metrics = [
  { value: "soil_moisture", label: "Umidade do solo", unit: "%" },
  { value: "soil_temp", label: "Temperatura do solo", unit: "°C" },
  { value: "air_temp", label: "Temperatura do ar", unit: "°C" },
  { value: "rainfall_mm", label: "Chuva acumulada", unit: "mm" },
] as const;

function normalizeFarm(farm: Farm & { _id?: string }): Farm {
  return { ...farm, id: entityId(farm) };
}
function normalizeField(field: Field & { _id?: string }): Field {
  return { ...field, id: entityId(field) };
}
function normalizeAlert<T extends { id?: string; _id?: string }>(item: T): T & { id: string } {
  return { ...item, id: entityId(item) };
}
function dateLabel(value?: string, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|\+00:00)$/.test(value);
  const options: Intl.DateTimeFormatOptions = calendarDate
    ? { dateStyle: "short", timeZone: "UTC" }
    : withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" };
  return new Intl.DateTimeFormat("pt-BR", options).format(date);
}
function operationDate(value: string, withTime = false): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }).format(date);
}
function operationDayKey(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function operationSource(operation: Operation): "simulated" | "real" { return operation.source === "real" ? "real" : "simulated"; }
// O prazo local controla a interface; a API continua responsável por validar assinatura e acesso.
function tokenExpirationMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = window.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims: { exp?: unknown } = JSON.parse(decoded);
    return typeof claims.exp === "number" && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}
function formatNumber(value: number, fraction = 0): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: fraction, minimumFractionDigits: fraction }).format(value);
}
function farmPlace(farm?: Farm): string {
  return farm ? `${farm.municipality}, ${farm.state}` : "Sua produção em um só lugar";
}

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-7h6v7"/></>,
    farm: <><path d="M3 20h18M5 20V9l7-5 7 5v11"/><path d="M9 20v-6h6v6M8 10h.01M16 10h.01"/></>,
    field: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.5 7.7 7.5 4.4 7.5-4.4M12 12.2V21M8 5.3l8 4.5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    down: <path d="m7 10 5 5 5-5"/>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    edit: <><path d="M12 20h9"/><path d="m16.5 3.5 4 4L8 20l-5 1 1-5 12.5-12.5Z"/></>,
    trash: <><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/></>,
    droplet: <><path d="M12 3s7 7.2 7 12a7 7 0 0 1-14 0c0-4.8 7-12 7-12Z"/><path d="M9 16a3 3 0 0 0 3 3"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>,
    leaf: <><path d="M20 4c-8 0-14 3-14 10a6 6 0 0 0 6 6c7 0 8-8 8-16Z"/><path d="M4 21c2-5 6-8 11-11"/></>,
    activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    dashboard: <><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="5" rx="1"/><rect x="13" y="10" width="8" height="11" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/></>,
    warehouse: <><path d="m3 9 9-6 9 6v11H3z"/><path d="M8 20v-6h8v6M7 10h.01M12 10h.01M17 10h.01"/></>,
    grid: <><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></>,
    wheat: <><path d="M12 22V9"/><path d="M12 12c-4 0-6-2-6-5 4 0 6 2 6 5ZM12 16c-4 0-6-2-6-5 4 0 6 2 6 5ZM12 12c4 0 6-2 6-5-4 0-6 2-6 5ZM12 16c4 0 6-2 6-5-4 0-6 2-6 5Z"/></>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6a1.5 1.5 0 0 0-3-1 1.5 1.5 0 0 0-3 1ZM8 10h8M8 14h8M8 18h5"/></>,
    radio: <><circle cx="12" cy="12" r="2"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.4 8.4a5 5 0 0 0 0 7.2M15.6 8.4a5 5 0 0 1 0 7.2"/></>,
    bellRing: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/><path d="M2 8a10 10 0 0 1 2-5M22 8a10 10 0 0 0-2-5"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg {...common}>{paths[name] ?? <circle cx="12" cy="12" r="8"/>}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand">{!compact && <span>Agro<span className="brand-light">Pulse</span></span>}</div>;
}

function AuthScreen({ onAuthenticated, sessionExpired = false, accountDeleted = false }: { onAuthenticated: (token: string, user: User) => void; sessionExpired?: boolean; accountDeleted?: boolean }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    try {
      if (mode === "register") {
        await apiFetch<User>("/auth/register", undefined, { method: "POST", body: JSON.stringify({ name, email, password }) });
      }
      const token = await apiFetch<{ access_token: string }>("/auth/login", undefined, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: email, password }),
      });
      const user = await apiFetch<User>("/auth/me", token.access_token);
      onAuthenticated(token.access_token, user);
    } catch (caught) {
      setError(detailOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-layout">
    <section className="auth-story">
      <div className="auth-brand"><Brand/><span>GESTÃO DE CAMPO, COM CONTEXTO</span></div>
      <div className="auth-story-content">
        <span className="eyebrow"><span className="eyebrow-dot"/> CONECTANDO DADOS AO CAMPO</span>
        <h1>Cada talhão conta uma história.</h1>
        <p>Veja sensores, manejos e clima no mesmo lugar. Acompanhe o que mudou e mantenha cada decisão ligada ao seu contexto.</p>
        <div className="auth-story-points"><span><Icon name="field" size={16}/> Mapa por talhão</span><span><Icon name="activity" size={16}/> Telemetria viva</span><span><Icon name="clipboard" size={16}/> Histórico rastreável</span></div>
      </div>
      <div className="auth-photo-caption"><span><i/>Área demonstrativa</span><strong>Pompéia, São Paulo</strong><small>Imagem ilustrativa · demonstração AgroPulse</small></div>
      <div className="auth-footer">AgroPulse <span>·</span> Operação agrícola conectada</div>
    </section>
    <section className="auth-form-side">
      <div className="auth-form-wrap">
        <div className="mobile-brand"><Brand/></div>
        <span className="auth-form-kicker">SEU ESPAÇO DE GESTÃO</span>
        <h2>{mode === "login" ? "Sua fazenda, em foco." : "Vamos começar."}</h2>
        <p className="auth-subtitle">{mode === "login" ? "Entre para acompanhar cada área, leitura e operação." : "Crie seu acesso e conecte as informações da sua produção."}</p>
        {sessionExpired && mode === "login" && <div className="integration-note" role="status">Sua sessão expirou. Entre novamente para continuar.</div>}
        {accountDeleted && mode === "login" && <div className="integration-note" role="status">Conta excluída com sucesso. Você saiu da sua conta.</div>}
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && <label>Seu nome<input name="name" type="text" placeholder="Ex.: Ana Souza" minLength={2} maxLength={80} autoComplete="name" required/></label>}
          <label>E-mail<input name="email" type="email" placeholder="voce@exemplo.com" autoComplete="email" required/></label>
          <label>Senha<input name="password" type="password" placeholder="Mínimo de 8 caracteres" minLength={8} maxLength={72} autoComplete={mode === "login" ? "current-password" : "new-password"} required/></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button primary full-width" type="submit" disabled={busy}>{busy ? <><span className="spinner"/> Aguarde…</> : mode === "login" ? "Entrar na plataforma" : "Criar minha conta"}</button>
        </form>
        <p className="auth-switch">{mode === "login" ? "Ainda não tem acesso?" : "Já tem uma conta?"} <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Criar conta" : "Fazer login"}</button></p>
        <p className="auth-note"><Icon name="check" size={15}/> Seus dados são acessados com segurança.</p>
      </div>
    </section>
  </main>;
}

function Sidebar({ page, setPage, farms, selectedFarmId, onFarmSelect, user, onLogout, onAccount, mobileOpen, closeMobile, alertCount }: {
  page: Page; setPage: (page: Page) => void; farms: Farm[]; selectedFarmId: string; alertCount: number;
  onFarmSelect: (id: string) => void; user: User; onLogout: () => void; onAccount: () => void; mobileOpen: boolean; closeMobile: () => void;
}) {
  const navGroups: { title: string; items: { key: Page; label: string; icon: string }[] }[] = [
    { title: "Operação", items: [{ key: "overview", label: "Visão geral", icon: "dashboard" }, { key: "farms", label: "Fazendas", icon: "warehouse" }, { key: "fields", label: "Talhões", icon: "grid" }] },
    { title: "Planejamento", items: [{ key: "seasons", label: "Safras", icon: "wheat" }, { key: "operations", label: "Operações", icon: "clipboard" }] },
    { title: "Inteligência de campo", items: [{ key: "insights", label: "Inteligência", icon: "activity" }, { key: "sensors", label: "Sensores", icon: "radio" }, { key: "alerts", label: "Alertas", icon: "bellRing" }] },
  ];
  return <>
    {mobileOpen && <button type="button" className="sidebar-backdrop" aria-label="Fechar menu" onClick={closeMobile}/>}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand/><button type="button" className="icon-button sidebar-close" onClick={closeMobile} aria-label="Fechar menu"><Icon name="close"/></button></div>
      <label className="sidebar-farm-select"><span>Fazenda</span><select value={selectedFarmId} disabled={!farms.length} onChange={(event) => { onFarmSelect(event.target.value); setPage("overview"); }}><option value="" disabled>Selecione uma fazenda</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name} · {farm.state}</option>)}</select><Icon name="down" size={15}/></label>
      <nav className="main-nav" aria-label="Menu principal">{navGroups.map((group) => <div className="nav-group" key={group.title}><h2>{group.title}</h2>{group.items.map((item) => <button type="button" key={item.key} aria-current={page === item.key ? "page" : undefined} className={`nav-link ${page === item.key ? "nav-active" : ""}`} onClick={() => { setPage(item.key); closeMobile(); }}><Icon name={item.icon}/><span>{item.label}</span>{item.key === "alerts" && alertCount > 0 && <span className="nav-alert-count">{alertCount}</span>}</button>)}</div>)}</nav>
      <div className="sidebar-bottom"><button type="button" className="profile-trigger" title="Editar minha conta" onClick={onAccount}><div className="profile-avatar">{user.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "A"}</div><div className="profile-copy"><strong>{user.name}</strong><span>{user.email}</span></div></button><button type="button" className="icon-button logout-button" title="Sair" aria-label="Sair" onClick={onLogout}><Icon name="logout"/></button></div>
    </aside>
  </>;
}

function Header({ page, onAdd, onMenu, hasFields, hasFarm, apiState, lastUpdated }: { page: Page; onAdd: () => void; onMenu: () => void; hasFields: boolean; hasFarm: boolean; apiState: ApiConnectionState; lastUpdated: number | null }) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const addLabel: Partial<Record<Page, string>> = { farms: "Nova fazenda", fields: "Novo talhão", seasons: "Nova safra", operations: "Nova operação", insights: "Registrar irrigação", sensors: "Vincular sensor", alerts: "Nova regra" };
  const needsField = page === "seasons" || page === "operations" || page === "insights" || page === "sensors" || page === "alerts";
  const actionLabel = needsField && !hasFields ? hasFarm ? "Novo talhão" : "Nova fazenda" : addLabel[page];
  const elapsedMinutes = lastUpdated === null ? null : Math.max(0, Math.floor((clock - lastUpdated) / 60_000));
  const syncLabel = elapsedMinutes !== null ? elapsedMinutes < 1 ? "Dados atualizados agora" : `Dados atualizados há ${elapsedMinutes} min` : apiState === "offline" ? "API sem conexão" : "Conectando à API";
  const syncTitle = lastUpdated === null ? "Aguardando uma resposta bem-sucedida da API" : `Última resposta bem-sucedida às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(lastUpdated)}`;
  return <header className="topbar"><div className="topbar-title"><button type="button" className="icon-button mobile-menu" aria-label="Abrir menu" onClick={onMenu}><Icon name="menu"/></button><p className="breadcrumb">AgroPulse <span>/</span> {pageTitles[page]}</p></div><div className="topbar-actions"><span className={`sync-indicator sync-${apiState}`} title={syncTitle} aria-live="polite"><i/>{syncLabel}</span>{actionLabel && <button type="button" className="button primary header-add" onClick={onAdd}><Icon name="plus" size={17}/>{actionLabel}</button>}</div></header>;
}

function MetricCard({ label, value, unit, caption, tone = "default", detail }: { label: string; value: string; unit?: string; caption: string; tone?: string; detail?: ReactNode }) {
  return <article className={`metric-card ${tone}`}><p className="metric-label">{label}</p><div className="metric-value">{value}<span>{unit}</span></div>{detail}{<p className="metric-caption">{caption}</p>}</article>;
}

function EmptyState({ title, body, action, onAction, icon = "farm" }: { title: string; body: string; action?: string; onAction?: () => void; icon?: string }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name={icon} size={27}/></span><h3>{title}</h3><p>{body}</p>{action && onAction && <button type="button" className="button primary" onClick={onAction}><Icon name="plus" size={16}/>{action}</button>}</div>;
}

function FarmCard({ farm, fields, fieldsCount, area, statsKnown, onSelect, onEdit, onDelete }: { farm: Farm; fields: Field[]; fieldsCount: number; area: number; statsKnown: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  const center: [number, number] = [farm.location.coordinates[1], farm.location.coordinates[0]];
  const cultureAreas = Object.entries(fields.reduce<Record<string, number>>((acc, field) => { acc[field.crop] = (acc[field.crop] ?? 0) + field.area_ha; return acc; }, {}));
  const totalArea = cultureAreas.reduce((sum, [, value]) => sum + value, 0) || 1;
  return <article className="farm-card"><div className="farm-card-main"><div className="farm-card-image"><FieldMap fields={fields} center={center} mini/><span className="farm-card-badge">{farm.state}</span></div><div className="farm-card-content"><div className="farm-card-title-row"><h3>{farm.name}</h3></div><p>{farmPlace(farm)}</p><div className="farm-card-stats">{statsKnown ? <><span>{fieldsCount} {fieldsCount === 1 ? "talhão" : "talhões"}</span><span>{formatNumber(area, 1)} ha</span></> : <span>Carregando áreas…</span>}<span className="farm-card-detail-hint">Abra a fazenda para ver sensores e alertas</span></div><div className="farm-culture-bar">{cultureAreas.map(([crop, value]) => <i key={crop} className={`crop-${crop}`} style={{ width: `${value / totalArea * 100}%` }} title={`${crops[crop as Field["crop"]] ?? crop}: ${formatNumber(value, 1)} ha`}/> )}</div></div></div><div className="farm-card-actions"><button type="button" className="button secondary" onClick={onSelect}>Abrir</button><details className="card-menu"><summary aria-label={`Mais ações para ${farm.name}`}>⋯</summary><div><button type="button" onClick={onEdit}>Editar</button><ConfirmAction prompt={`Excluir a fazenda “${farm.name}” e os talhões vinculados?`} onConfirm={onDelete} className="danger-link">Excluir</ConfirmAction></div></details></div></article>;
}

function FieldRow({ field, farm, selected, onSelect, onEdit, onDelete }: { field: Field; farm?: Farm; selected?: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className={`field-row ${selected ? "field-row-selected" : ""}`}><button type="button" aria-pressed={Boolean(selected)} className="field-row-main" onClick={onSelect}><span className={`crop-symbol crop-${field.crop}`}><Icon name="leaf" size={18}/></span><span className="field-name-block"><strong>{field.name}</strong><small>{farm?.name ?? "Fazenda"} · {crops[field.crop] ?? field.crop}</small></span><span className="field-area">{formatNumber(field.area_ha, 1)} <small>ha</small></span></button><details className="field-actions card-menu"><summary aria-label={`Mais ações para ${field.name}`}>⋯</summary><div><button type="button" onClick={onEdit}>Editar</button><ConfirmAction prompt={`Excluir o talhão “${field.name}”?`} onConfirm={onDelete} className="danger-link">Excluir</ConfirmAction></div></details></div>;
}

function FarmForm({ mode, farm, onClose, onSave, busy }: { mode: "create" | "edit"; farm?: Farm; onClose: () => void; onSave: (body: object) => Promise<void>; busy: boolean }) {
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    const lat = Number(data.get("latitude")); const lon = Number(data.get("longitude"));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) { setError("Informe latitude e longitude válidas."); return; }
    try { await onSave({ name: String(data.get("name")).trim(), municipality: String(data.get("municipality")).trim(), state: String(data.get("state")).trim().toUpperCase(), location: { type: "Point", coordinates: [lon, lat] } }); }
    catch (caught) { setError(detailOf(caught)); }
  };
  return <Modal title={mode === "create" ? "Cadastrar fazenda" : "Editar fazenda"} subtitle="Informações da propriedade rural." onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-grid"><label className="span-2">Nome da fazenda<input name="name" defaultValue={farm?.name} placeholder="Ex.: Fazenda Boa Esperança" minLength={2} maxLength={120} required autoFocus/></label><label>Município<input name="municipality" defaultValue={farm?.municipality} placeholder="Ex.: Ribeirão Preto" minLength={2} maxLength={120} required/></label><label>Estado<select name="state" defaultValue={farm?.state ?? "SP"} required>{states.map((state) => <option key={state} value={state}>{state}</option>)}</select></label><label>Latitude<input name="latitude" type="number" step="any" defaultValue={farm?.location?.coordinates?.[1]} placeholder="-21.1775" required/></label><label>Longitude<input name="longitude" type="number" step="any" defaultValue={farm?.location?.coordinates?.[0]} placeholder="-47.8103" required/></label></div><p className="form-hint">As coordenadas posicionam a propriedade no mapa e ajudam a contextualizar os talhões.</p>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : mode === "create" ? "Cadastrar fazenda" : "Salvar alterações"}</button></div></form></Modal>;
}

function FieldForm({ mode, field, farm, onClose, onSave, busy }: { mode: "create" | "edit"; field?: Field; farm?: Farm; onClose: () => void; onSave: (body: object) => Promise<void>; busy: boolean }) {
  const [points, setPoints] = useState<[number, number][]>([]);
  const [error, setError] = useState("");
  const draw = (point: [number, number]) => setPoints((current) => [...current, point]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    if (!farm) { setError("Selecione uma fazenda antes de cadastrar o talhão."); return; }
    if ((!field && points.length < 3) || (points.length > 0 && points.length < 3)) { setError("Desenhe o limite do talhão com pelo menos 3 pontos no mapa."); return; }
    let boundary = field?.boundary;
    if (points.length) {
      const ring: [number, number][] = [...points];
      ring.push(ring[0]);
      boundary = { type: "Polygon", coordinates: [ring] };
    }
    const data = new FormData(event.currentTarget);
    try { await onSave({ farm_id: farm.id, name: String(data.get("name")).trim(), crop: String(data.get("crop")), boundary, attributes: field?.attributes ?? {} }); }
    catch (caught) { setError(detailOf(caught)); }
  };
  const mapCenter: [number, number] | undefined = farm ? [farm.location.coordinates[1], farm.location.coordinates[0]] : undefined;
  return <Modal title={mode === "create" ? "Adicionar talhão" : "Editar talhão"} subtitle={farm ? `${farm.name} · ${farmPlace(farm)}` : "Selecione a fazenda onde fica esta área."} onClose={onClose} wide><form className="modal-form" onSubmit={submit}><div className="form-grid"><label>Nome do talhão<input name="name" defaultValue={field?.name} placeholder="Ex.: Gleba Norte" maxLength={120} required autoFocus/></label><label>Cultura<select name="crop" defaultValue={field?.crop ?? "soja"}>{Object.entries(crops).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="draw-section"><div className="draw-title"><div><strong>Limite da área</strong><p>{field && !points.length ? "O desenho atual aparece no mapa. Clique para redesenhar o limite; sem novos pontos, ele será preservado." : "Toque ou clique no mapa para desenhar o perímetro."}</p></div><div className="draw-actions"><button className="text-button" type="button" disabled={!points.length} onClick={() => setPoints((current) => current.slice(0, -1))}>Desfazer ponto</button><button className="text-button" type="button" disabled={!points.length} onClick={() => setPoints([])}>Reiniciar desenho</button></div></div><FieldMap fields={field && !points.length ? [field] : []} selectedFieldId={field?.id} center={mapCenter} drawPoints={points} onDraw={draw}/><p className="form-hint">Mapa de satélite centralizado na propriedade. Clique nos limites para formar o perímetro GeoJSON.</p></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : mode === "create" ? "Cadastrar talhão" : "Salvar alterações"}</button></div></form></Modal>;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogAccessibility(dialogRef, onClose);
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}><Icon name="close"/></button></div>{children}</section></div>;
}

const states = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

function AlertRulesPanel({ rules, fields, onSave, onToggle, onDelete, supported, busy, loading, createRequest }: { rules: AlertRule[]; fields: Field[]; onSave: (rule: AlertRule | undefined, body: object) => Promise<void>; onToggle: (rules: AlertRule[]) => void; onDelete: (rules: AlertRule[]) => void; supported: boolean; busy: boolean; loading: boolean; createRequest: number }) {
  const [formOpen, setFormOpen] = useState(false); const [editingRule, setEditingRule] = useState<AlertRule>(); const [error, setError] = useState("");
  useEffect(() => { if (createRequest > 0) { setError(""); setEditingRule(undefined); setFormOpen(true); } }, [createRequest]);
  const openEditForm = (rule: AlertRule) => { setEditingRule(rule); setError(""); setFormOpen(true); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    const threshold = Number(data.get("threshold")); const windowMinutes = Number(data.get("window_minutes"));
    if (!Number.isFinite(threshold)) { setError("Informe um limite numérico válido."); return; }
    if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 525600) { setError("A janela deve ser um número inteiro entre 1 e 525.600 minutos."); return; }
    const body = { field_id: String(data.get("field_id")), metric: String(data.get("metric")), operator: String(data.get("operator")), threshold, window_minutes: windowMinutes };
    try { await onSave(editingRule, editingRule ? body : { ...body, active: true }); setFormOpen(false); setEditingRule(undefined); }
    catch (caught) { setError(detailOf(caught)); }
  };
  const groupedRules = Object.values(rules.reduce<Record<string, AlertRule[]>>((groups, rule) => { const key = `${rule.metric}|${rule.operator}|${rule.threshold}|${rule.window_minutes}`; groups[key] ??= []; groups[key].push(rule); return groups; }, {}));
  return <section className="panel alert-rules-panel"><div className="panel-heading"><div><h2>Regras</h2><p>Defina limites para acompanhar condições importantes.</p></div>{formOpen && !editingRule && <button type="button" className="text-button" disabled={busy} onClick={() => setFormOpen(false)}>Cancelar</button>}</div>
    {!supported && <div className="integration-note"><Icon name="clock" size={16}/> Regras de alerta estarão disponíveis quando a API for atualizada.</div>}
    {formOpen && <form key={editingRule ? entityId(editingRule) : "new-rule"} className="rule-form" onSubmit={submit}><label>Talhão<select name="field_id" defaultValue={editingRule?.field_id ?? fields[0]?.id} required>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label>Métrica<select name="metric" defaultValue={editingRule?.metric ?? metrics[0].value}>{metrics.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></label><label>Condição<select name="operator" defaultValue={editingRule?.operator ?? "lt"}><option value="lt">Abaixo de</option><option value="gt">Acima de</option></select></label><label>Limite<input name="threshold" type="number" step="any" defaultValue={editingRule?.threshold ?? 30} required/></label><label>Janela (minutos)<input name="window_minutes" type="number" min="1" max="525600" step="1" defaultValue={editingRule?.window_minutes ?? 15} required/></label><div className="rule-form-actions"><button type="button" className="text-button" disabled={busy} onClick={() => { setFormOpen(false); setEditingRule(undefined); }}>Cancelar</button><button className="button primary compact-button" disabled={busy}>{busy ? "Salvando…" : editingRule ? "Salvar alterações" : "Criar regra"}</button></div>{error && <div className="inline-error rule-error" role="alert">{error}</div>}</form>}
    {supported && loading && rules.length === 0 && !formOpen && <div className="list-loading"><span className="skeleton"/>Carregando regras…</div>}
    {supported && !loading && rules.length === 0 && !formOpen && <div className="panel-empty"><span className="soft-icon"><Icon name="bell"/></span><div><strong>Nenhuma regra configurada</strong><p>Crie uma regra para acompanhar leituras fora dos limites definidos.</p></div></div>}
    {supported && rules.length > 0 && <div className="rules-list">{groupedRules.map((group) => { const rule = group[0]; const metric = metrics.find((item) => item.value === rule.metric); const active = group.every((item) => item.active !== false); return <div className="rule-row" key={`${rule.metric}-${rule.operator}-${rule.threshold}-${rule.window_minutes}`}><div className="rule-copy"><strong>{metric?.label ?? rule.metric} {rule.operator === "lt" ? "abaixo de" : "acima de"} {formatNumber(rule.threshold, 1)} {metric?.unit} por {rule.window_minutes} min</strong><div className="rule-field-chips">{group.map((item) => { const field = fields.find((candidate) => candidate.id === item.field_id); return <span className={`rule-field-chip crop-${field?.crop ?? "soja"}`} key={entityId(item)}>{field?.name ?? "Talhão"}</span>; })}</div></div><button type="button" className="icon-button" aria-label="Editar regra" title="Editar regra" disabled={busy} onClick={() => openEditForm(rule)}><Icon name="edit" size={15}/></button><button type="button" className={`toggle ${active ? "" : "toggle-off"}`} aria-label={active ? "Pausar regra" : "Ativar regra"} disabled={busy} onClick={() => onToggle(group)}><span/></button><details className="card-menu"><summary aria-label="Mais ações da regra">⋯</summary><div><ConfirmAction prompt={`Excluir esta regra dos ${group.length} talhões vinculados?`} onConfirm={() => onDelete(group)} className="danger-link">Excluir</ConfirmAction></div></details></div>; })}</div>}
  </section>;
}

function SeasonCollection({ fields, selectedFieldId, seasons, loading, error, onFieldChange, onPlanField, onEdit, onDelete, onSetupFields, setupLabel }: {
  fields: Field[]; seasons: Season[]; loading: boolean; error: string;
  selectedFieldId: string; onFieldChange: (fieldId: string) => void; onPlanField: (fieldId: string) => void; onEdit: (season: Season) => void; onDelete: (season: Season) => void;
  onSetupFields: () => void; setupLabel: string;
}) {
  const [year, setYear] = useState(() => {
    const today = new Date();
    const first = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
    return `${first}/${String(first + 1).slice(-2)}`;
  });
  const [fieldFilter, setFieldFilter] = useState(selectedFieldId);
  const months = ["Jul", "Ago", "Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun"];
  const startYear = Number(year.slice(0, 4));
  const cycleStartYear = (dateValue: string) => { const date = new Date(dateValue); return date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1; };
  const cycleLabel = (dateValue: string) => { const first = cycleStartYear(dateValue); return `${first}/${String(first + 1).slice(-2)}`; };
  const today = new Date();
  const currentStartYear = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  const latestStartYear = Math.max(currentStartYear, ...seasons.map((season) => cycleStartYear(season.planting_date)));
  const changeYear = (offset: number) => {
    const next = startYear + offset;
    if (next <= latestStartYear) setYear(`${next}/${String(next + 1).slice(-2)}`);
  };
  const currentMonth = (new Date().getMonth() + 6) % 12 + 1;
  const timelineSeasons = seasons.filter((season) => cycleLabel(season.planting_date) === year);
  const visibleFields = fieldFilter === "all" ? fields : fields.filter((item) => item.id === fieldFilter);
  const selectedSeason = fieldFilter === "all" ? undefined : timelineSeasons.find((season) => season.field_id === fieldFilter);
  useEffect(() => { setFieldFilter(selectedFieldId); }, [selectedFieldId]);
  const yieldProgress = selectedSeason?.expected_yield_kg_ha && selectedSeason.yield_kg_ha != null
    ? selectedSeason.yield_kg_ha / selectedSeason.expected_yield_kg_ha * 100
    : null;
  return <section className="collection-page seasons-page"><div className="collection-heading"><div><h2>Safras</h2><span>Planeje o ciclo produtivo e compare produtividade prevista e realizada.</span></div><div className="season-heading-controls"><label className="season-field-select"><span>Talhão</span><select aria-label="Filtrar safras por talhão" value={fieldFilter} onChange={(event) => { const value = event.target.value; setFieldFilter(value); if (value !== "all") onFieldChange(value); }}><option value="all">Todos os talhões</option>{fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="season-year-tabs" role="group" aria-label="Navegação entre anos-safra"><button type="button" className="season-year-arrow previous" onClick={() => changeYear(-1)} aria-label="Ano-safra anterior" title="Ano-safra anterior"><Icon name="chevron" size={16}/></button><span className="season-year-current" aria-live="polite">{year}</span><button type="button" className="season-year-arrow" onClick={() => changeYear(1)} disabled={startYear >= latestStartYear} aria-label="Ano-safra seguinte" title={startYear >= latestStartYear ? "Você já está no ano-safra mais recente" : "Ano-safra seguinte"}><Icon name="chevron" size={16}/></button></div></div></div>
    {error && <div className="workspace-warning"><Icon name="bell" size={17}/>{error}</div>}
    {!fields.length ? <EmptyState title="Nenhum talhão disponível" body="Cadastre uma fazenda e um talhão antes de planejar uma safra." action={setupLabel} onAction={onSetupFields} icon="field"/> : loading ? <div className="panel list-loading"><span className="skeleton"/>Carregando safras…</div> : <div className="season-page-grid"><section className="panel season-timeline"><div className="season-grid-header"><strong>Talhão</strong>{months.map((month) => <span key={month}>{month}</span>)}</div>{visibleFields.map((field) => {
      const season = timelineSeasons.find((item) => item.field_id === field.id);
      const start = season ? (new Date(season.planting_date).getUTCMonth() + 6) % 12 + 1 : currentMonth;
      const end = season?.harvest_date ? (new Date(season.harvest_date).getUTCMonth() + 6) % 12 + 1 : start;
      const span = season ? Math.max(1, (end - start + 12) % 12 + 1) : 1;
      return <div className="season-grid-row" key={field.id}><div className="season-field-name"><span className={`overview-field-color crop-${field.crop}`}/><span>{field.name}</span></div><div className="season-month-track">{months.map((month) => <i key={month}/>)}{season ? <button type="button" className={`season-bar crop-${season.crop ?? field.crop}`} style={{ gridColumn: `${start} / span ${span}` }} onClick={() => onEdit(season)} title={`${dateLabel(season.planting_date)}–${dateLabel(season.harvest_date ?? undefined)}`}>{season.label}</button> : <button type="button" className="season-unplanned" style={{ gridColumn: `${currentMonth} / span ${Math.min(3, 13 - currentMonth)}` }} onClick={() => onPlanField(field.id)}>Sem safra planejada · Planejar</button>}</div></div>;
    })}</section><aside className="panel season-yield-panel"><h3>Produtividade</h3>{selectedSeason ? <><p>{fields.find((field) => field.id === selectedSeason.field_id)?.name} · {selectedSeason.label}</p><div className="yield-row yield-target"><span>Meta prevista</span><strong>{selectedSeason.expected_yield_kg_ha == null ? "—" : `${formatNumber(selectedSeason.expected_yield_kg_ha, 0)} kg/ha`}</strong><small>Valor definido no planejamento</small></div><div className="yield-row yield-realized"><span>Realizada</span><strong>{selectedSeason.yield_kg_ha == null ? "—" : `${formatNumber(selectedSeason.yield_kg_ha, 0)} kg/ha`}</strong>{yieldProgress !== null && <div className="yield-progress-track" role="meter" aria-label="Produtividade realizada em relação à meta" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(yieldProgress, 100))}><i style={{ width: `${Math.max(0, Math.min(yieldProgress, 100))}%` }}/></div>}<small>{yieldProgress !== null ? `${formatNumber(yieldProgress, 0)}% da meta` : selectedSeason.yield_kg_ha == null ? "Aguardando dados da colheita" : "Defina uma meta para comparar"}</small></div><div className="record-actions"><button type="button" onClick={() => onEdit(selectedSeason)}>Editar</button><ConfirmAction prompt={`Excluir a safra “${selectedSeason.label}”?`} onConfirm={() => onDelete(selectedSeason)} className="danger-link">Excluir</ConfirmAction></div></> : <p>Sem safra registrada para {year}.</p>}</aside></div>}
  </section>;
}

function OperationCollection({ field, fields, operations, seasons, loading, error, onQuickAdd, onEdit, onDelete, onSetupFields, setupLabel, token }: {
  field?: Field; fields: Field[]; operations: Operation[]; seasons: Season[]; loading: boolean; error: string; token: string;
  onQuickAdd: (type: Operation["type"]) => void; onEdit: (operation: Operation) => void; onDelete: (operation: Operation) => void; onSetupFields: () => void; setupLabel: string;
}) {
  const [typeFilter, setTypeFilter] = useState<Operation["type"] | "all">("all");
  const [fieldFilter, setFieldFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"simulated" | "real" | "all">("all");
  const [seasonFilter, setSeasonFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const types: Operation["type"][] = ["plantio", "adubacao", "aplicacao", "irrigacao", "colheita"];
  const typeIcons: Record<Operation["type"], string> = { plantio: "wheat", adubacao: "leaf", aplicacao: "activity", irrigacao: "droplet", colheita: "check" };
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const searchText = search.trim().toLocaleLowerCase("pt-BR");
  useEffect(() => { setFieldFilter("all"); setSeasonFilter("all"); }, [fields]);
  useEffect(() => { setCurrentPage(0); }, [typeFilter, fieldFilter, sourceFilter, seasonFilter, dateFrom, dateTo, search]);
  const visibleOperations = useMemo(() => operations.filter((operation) => {
    const day = operationDayKey(operation.date);
    const operationField = fields.find((item) => item.id === operation.field_id);
    const season = seasons.find((item) => item.id === operation.season_id);
    const details = JSON.stringify(operation.details ?? {}).toLocaleLowerCase("pt-BR");
    const matchesSearch = !searchText || `${operationTypeLabel[operation.type]} ${operationField?.name ?? ""} ${operationField ? crops[operationField.crop] : ""} ${season?.label ?? ""} ${details}`.toLocaleLowerCase("pt-BR").includes(searchText);
    return (typeFilter === "all" || operation.type === typeFilter)
      && (fieldFilter === "all" || operation.field_id === fieldFilter)
      && (sourceFilter === "all" || operationSource(operation) === sourceFilter)
      && (seasonFilter === "all" || operation.season_id === seasonFilter)
      && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo)
      && matchesSearch;
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [operations, fields, seasons, typeFilter, fieldFilter, sourceFilter, seasonFilter, dateFrom, dateTo, searchText]);
  const totalCost = visibleOperations.reduce((sum, operation) => sum + (operation.cost_brl ?? 0), 0);
  const operatedAreas = visibleOperations.reduce((areas, operation) => {
    const fieldArea = fields.find((item) => item.id === operation.field_id)?.area_ha ?? 0;
    const area = Number(operation.details?.area_ha) || fieldArea;
    areas.set(operation.field_id, Math.max(areas.get(operation.field_id) ?? 0, area));
    return areas;
  }, new Map<string, number>());
  const uniqueFieldArea = [...operatedAreas.values()].reduce((sum, area) => sum + area, 0);
  const costPerHa = totalCost / uniqueFieldArea;
  const latest = visibleOperations[0];
  const pageSize = 12;
  const pageCount = Math.max(1, Math.ceil(visibleOperations.length / pageSize));
  const safePage = Math.min(currentPage, pageCount - 1);
  const pageOperations = visibleOperations.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const grouped = pageOperations.reduce<Record<string, Operation[]>>((acc, operation) => { const key = operationDayKey(operation.date); acc[key] ??= []; acc[key].push(operation); return acc; }, {});
  const costByCategory = ["insumos", "mao_de_obra", "maquinas", "combustivel", "outros"].map((category) => ({ category, total: visibleOperations.reduce((sum, operation) => sum + (Number((operation.details?.cost_breakdown as Record<string, unknown> | undefined)?.[category]) || 0), 0) })).filter((item) => item.total > 0);
  const costByType = types.map((type) => ({ type, total: visibleOperations.filter((operation) => operation.type === type).reduce((sum, operation) => sum + (operation.cost_brl ?? 0), 0) })).filter((item) => item.total > 0);
  const clearFilters = () => { setTypeFilter("all"); setFieldFilter("all"); setSourceFilter("all"); setSeasonFilter("all"); setDateFrom(""); setDateTo(""); setSearch(""); setCurrentPage(0); };
  const downloadAttachment = async (operation: Operation, attachment: OperationAttachment) => {
    setDownloading(attachment.file_id); setDownloadError("");
    try {
      const blob = await apiBlob(`/operations/${encodeURIComponent(operation.id)}/attachments/${encodeURIComponent(attachment.file_id)}`, token);
      const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = attachment.filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (caught) { setDownloadError(caught instanceof Error ? caught.message : "Não foi possível baixar o anexo."); }
    finally { setDownloading(null); }
  };
  return <section className="collection-page operations-page"><div className="collection-heading"><div><h2>Operações</h2><span>Atividades, custos e comprovantes por talhão.</span></div></div>
    <div className="demo-notice operations-demo-notice"><strong>Ambiente de demonstração</strong><span>Os registros de demonstração são fictícios e não representam atividade, produtividade ou custos reais. Use os filtros de origem para separar registros reais.</span></div>
    {error && <div className="workspace-warning"><Icon name="bell" size={17}/>{error}</div>}{!fields.length ? <EmptyState title="Nenhum talhão disponível" body="Cadastre uma fazenda e um talhão antes de registrar operações." action={setupLabel} onAction={onSetupFields} icon="field"/> : <>
    <IrrigationResponsePanel field={field} token={token}/>
    <div className="operations-summary"><div><span>Operações no filtro</span><strong>{visibleOperations.length}</strong></div><div><span>Custo total no filtro</span><strong>{money.format(totalCost)}</strong></div><div title="Custo total dividido pela área única dos talhões incluídos no filtro."><span>Custo por hectare · área única</span><strong>{Number.isFinite(costPerHa) ? `${money.format(costPerHa)}/ha` : "—"}</strong></div><div><span>Último registro</span><strong>{latest ? operationDate(latest.date) : "—"}</strong></div></div>
    <div className="operation-filter-panel"><div className="operation-filter-row" aria-label="Filtrar operações por origem"><span>Origem</span>{[{ value: "simulated", label: "Fictícias" }, { value: "real", label: "Reais" }, { value: "all", label: "Todas" }].map((item) => <button type="button" key={item.value} aria-pressed={sourceFilter === item.value} className={`filter-chip ${sourceFilter === item.value ? "active" : ""}`} onClick={() => setSourceFilter(item.value as typeof sourceFilter)}>{item.label}</button>)}</div>
      <div className="operation-filters" aria-label="Filtrar operações por tipo">{[{ value: "all", label: "Todos os tipos" }, ...types.map((value) => ({ value, label: operationTypeLabel[value] }))].map((item) => <button type="button" key={item.value} aria-pressed={typeFilter === item.value} className={`filter-chip type-chip type-${item.value} ${typeFilter === item.value ? "active" : ""}`} onClick={() => setTypeFilter(item.value as Operation["type"] | "all")}>{item.value !== "all" && <Icon name={typeIcons[item.value as Operation["type"]]} size={15}/>} {item.label}</button>)}</div>
      <div className="operation-filter-controls"><label>Talhão<select value={fieldFilter} onChange={(event) => { setFieldFilter(event.target.value); setSeasonFilter("all"); }}><option value="all">Todos os talhões</option>{fields.map((item) => <option key={item.id} value={item.id}>{item.name} · {crops[item.crop]}</option>)}</select></label><label>Safra<select value={seasonFilter} onChange={(event) => setSeasonFilter(event.target.value)}><option value="all">Todas as safras</option>{seasons.filter((season) => fieldFilter === "all" || season.field_id === fieldFilter).map((season) => { const seasonField = fields.find((item) => item.id === season.field_id); return <option key={season.id} value={season.id}>{season.label} · {seasonField?.name ?? "Talhão"}</option>; })}</select></label><label>De<input type="date" max={dateTo || undefined} value={dateFrom} onChange={(event) => setDateFrom(event.target.value)}/></label><label>Até<input type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => setDateTo(event.target.value)}/></label><label className="operation-search">Buscar<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Produto, observação, responsável…"/></label><button type="button" className="text-button" onClick={clearFilters}>Limpar filtros</button></div>
    </div>
    {costByType.length > 0 && <section className="operation-cost-analytics"><div><h3>Custos por tipo de atividade</h3><div className="operation-cost-pills">{costByType.map(({ type, total }) => <span key={type}>{operationTypeLabel[type]} <strong>{money.format(total)}</strong></span>)}</div></div>{costByCategory.length > 0 && <div><h3>Composição dos custos</h3><div className="operation-cost-pills">{costByCategory.map(({ category, total }) => <span key={category}>{({ insumos: "Insumos", mao_de_obra: "Mão de obra", maquinas: "Máquinas", combustivel: "Combustível", outros: "Outros" } as Record<string, string>)[category]} <strong>{money.format(total)}</strong></span>)}</div></div>}</section>}
    {downloadError && <div className="inline-error" role="alert">{downloadError}</div>}
    {loading ? <div className="panel list-loading"><span className="skeleton"/>Carregando operações…</div> : visibleOperations.length ? <><div className="operation-results-count">Exibindo {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, visibleOperations.length)} de {visibleOperations.length} operações</div><div className="operations-timeline">{Object.entries(grouped).map(([day, items]) => <section className="operation-day" key={day}><time className="operation-day-date">{operationDate(day)}</time><div className="operation-day-items">{items.map((operation) => {
      const operationField = fields.find((item) => item.id === operation.field_id); const season = seasons.find((item) => item.id === operation.season_id); const note = operation.details?.observacoes;
      const attachments = (Array.isArray(operation.details?.attachments) ? operation.details.attachments : []) as OperationAttachment[];
      const operationData = (operation.details?.operation_data ?? {}) as Record<string, unknown>;
      const tracking = [typeof operation.details?.responsavel === "string" ? `Responsável: ${operation.details.responsavel}` : "", typeof operation.details?.equipamento === "string" ? `Equipamento: ${operation.details.equipamento}` : ""].filter(Boolean).join(" · ");
      return <article className="operation-row" key={operation.id}><div className="operation-info"><div className="operation-title"><h3>{operationTypeLabel[operation.type]}</h3><span>{operationDate(operation.date, true)}</span><span className={`operation-source source-${operationSource(operation)}`}>{operationSource(operation) === "real" ? "Real" : "Fictício · demonstração"}</span></div><p>{operationField?.name ?? field?.name}{operationField ? ` · ${crops[operationField.crop]}` : ""}{season ? ` · Safra ${season.label}` : ""}{operation.cost_brl == null ? "" : ` · ${money.format(operation.cost_brl)}`}{operation.details?.area_ha ? ` · ${formatNumber(Number(operation.details.area_ha), 2)} ha` : ""}</p>
        {Object.entries(operationData).length > 0 && <div className="operation-detail-tags">{Object.entries(operationData).map(([key, value]) => <span key={key}>{key.replaceAll("_", " ")}: {String(value)}</span>)}</div>}
        {typeof note === "string" && note && <small>{note}</small>}
        {tracking && <small>{tracking}</small>}
        {attachments.length > 0 && <div className="operation-attachments"><strong>Anexos</strong>{attachments.map((attachment) => <button type="button" key={attachment.file_id} disabled={downloading === attachment.file_id} onClick={() => void downloadAttachment(operation, attachment)}>{attachment.filename}{downloading === attachment.file_id ? " · baixando…" : ""}</button>)}</div>}
        <details className="operation-audit"><summary>Rastreabilidade</summary>{operation.created_by ? <p>Criado por {operation.created_by}{operation.created_at ? ` em ${operationDate(operation.created_at, true)}` : ""}{operation.updated_at ? ` · alterado por ${operation.updated_by ?? "—"} em ${operationDate(operation.updated_at, true)}` : ""}</p> : <p>Registro anterior à trilha de auditoria; autor e data de criação não foram armazenados.</p>}{operation.history?.map((entry, index) => <small key={`${entry.at}-${index}`}>{entry.action === "created" ? "Registro criado" : entry.action === "attachment_added" ? "Anexo incluído" : "Registro atualizado"} · {entry.by} · {operationDate(entry.at, true)}{entry.changes && Object.keys(entry.changes).length ? ` · ${Object.keys(entry.changes).join(", ")}` : ""}</small>)}</details>
      </div><div className="record-actions"><button type="button" onClick={() => onEdit(operation)} aria-label="Editar operação"><Icon name="edit" size={15}/></button><ConfirmAction prompt="Excluir esta operação do histórico?" onConfirm={() => onDelete(operation)} className="icon-confirm"><Icon name="trash" size={15}/></ConfirmAction></div></article>;
        })}</div></section>)}</div><nav className="operations-pagination" aria-label="Paginação das operações"><button type="button" className="button secondary compact-button" aria-label="Página anterior" disabled={safePage === 0} onClick={() => setCurrentPage(safePage - 1)}>Anterior</button><span aria-live="polite">Página {safePage + 1} de {pageCount}</span><button type="button" className="button secondary compact-button" aria-label="Próxima página" disabled={safePage + 1 >= pageCount} onClick={() => setCurrentPage(safePage + 1)}>Próxima</button></nav></> : <div className="operations-empty"><h3>Nenhuma operação corresponde aos filtros</h3><p>Amplie o período, mude a origem ou limpe os filtros para ver outros registros.</p><button type="button" className="button secondary" onClick={clearFilters}>Limpar filtros</button></div>}
    <div className="quick-register"><strong>Registro rápido · {field?.name ?? "talhão selecionado"}</strong>{types.map((type) => <button type="button" key={type} className={`quick-${type}`} onClick={() => onQuickAdd(type)}><Icon name={typeIcons[type]}/>{operationTypeLabel[type]}</button>)}</div>
    </>}
  </section>;
}

function SensorCollection({ fields, sensors, readings, loading, error, onEdit, onToggle, onDelete, onSetupFields, setupLabel, onAddSensor }: {
  fields: Field[]; sensors: Sensor[]; readings: Reading[]; loading: boolean; error: string;
  onEdit: (sensor: Sensor) => void; onToggle: (sensor: Sensor) => Promise<void>; onDelete: (sensor: Sensor) => void;
  onSetupFields: () => void; setupLabel: string; onAddSensor: (fieldId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "online" | "attention" | "inactive">("all");
  const [selectedSensorId, setSelectedSensorId] = useState("");
  const [pendingSensors, setPendingSensors] = useState<Set<string>>(() => new Set());
  const queryExample = `curl -H "Authorization: Bearer <token>" "${apiUrl("/fields/<field_id>/readings/latest")}"`;
  const copyQuery = async () => {
    setCopyError(false);
    try { await navigator.clipboard.writeText(queryExample); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); setCopyError(true); }
  };
  const minuteLabel = (value?: string) => { if (!value) return "Sem leitura"; const mins = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000)); return mins < 1 ? "agora" : `há ${mins} min`; };
  const statusFor = (sensor: Sensor): "inactive" | "offline" | "delayed" | "online" | "unconfigured" => {
    if (!sensor.active) return "inactive";
    const timestamp = readings.find((item) => item.sensor_id === sensor.id)?.ts;
    if (!timestamp) return sensor.source === "real" ? "unconfigured" : "offline";
    const timestampMs = new Date(timestamp).getTime();
    if (!Number.isFinite(timestampMs)) return sensor.source === "real" ? "unconfigured" : "offline";
    const age = Date.now() - timestampMs;
    return age > 3_600_000 ? "offline" : age > 900_000 ? "delayed" : "online";
  };
  const statusLabel = (status: string) => status === "inactive" ? "Inativo" : status === "offline" ? "Offline" : status === "delayed" ? "Atrasado" : status === "unconfigured" ? "Sem ingestão" : "Online";
  const counts = sensors.reduce((total, sensor) => { const status = statusFor(sensor); total[status] += 1; return total; }, { online: 0, delayed: 0, offline: 0, inactive: 0, unconfigured: 0 });
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const sensorMatches = (sensor: Sensor, field: Field) => {
    const status = statusFor(sensor);
    const matchesStatus = statusFilter === "all" || (statusFilter === "online" ? status === "online" : statusFilter === "attention" ? status === "offline" || status === "delayed" || status === "unconfigured" : status === "inactive");
    const matchesText = !normalizedSearch || `${sensor.device_id} ${field.name} ${crops[field.crop]}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch);
    return matchesStatus && matchesText;
  };
  const toggle = async (sensor: Sensor) => {
    setPendingSensors((current) => new Set(current).add(sensor.id));
    try { await onToggle(sensor); }
    finally { setPendingSensors((current) => { const next = new Set(current); next.delete(sensor.id); return next; }); }
  };
  const visibleCount = fields.reduce((count, field) => count + sensors.filter((sensor) => sensor.field_id === field.id && sensorMatches(sensor, field)).length, 0);
  const visibleSensors = sensors.filter((sensor) => { const field = fields.find((item) => item.id === sensor.field_id); return field ? sensorMatches(sensor, field) : false; });
  const mapSensors = useMemo(() => locateSensors(fields, visibleSensors), [fields, visibleSensors]);
  useEffect(() => {
    if (!mapSensors.some((sensor) => sensor.id === selectedSensorId)) setSelectedSensorId(mapSensors[0]?.id ?? "");
  }, [mapSensors, selectedSensorId]);
  const selectedSensor = mapSensors.find((sensor) => sensor.id === selectedSensorId);
  const selectedField = selectedSensor ? fields.find((item) => item.id === selectedSensor.field_id) : undefined;
  const selectedReading = selectedSensor ? readings.find((item) => item.sensor_id === selectedSensor.id) : undefined;
  const mapCenter = fields[0]?.centroid?.coordinates ? [fields[0].centroid.coordinates[1], fields[0].centroid.coordinates[0]] as [number, number] : undefined;
  return <section className="collection-page sensors-page">
    <div className="collection-heading"><div><h2>Sensores</h2><span>Posicione cada dispositivo no talhão e acompanhe leituras simuladas ou reais.</span></div></div>
    {error && <div className="workspace-warning" role="alert"><Icon name="bell" size={17}/>{error}</div>}
    {!fields.length ? <EmptyState title="Nenhum talhão disponível" body="Cadastre um talhão para vincular sensores à área monitorada." action={setupLabel} onAction={onSetupFields} icon="field"/> : loading ? <div className="panel list-loading"><span className="skeleton"/>Carregando sensores…</div> : <>
      <div className="sensor-summary" aria-label="Resumo de sensores"><article><span>Total vinculado</span><strong>{sensors.length}</strong></article><article className="sensor-summary-online"><span>Online</span><strong>{counts.online}</strong></article><article className="sensor-summary-attention"><span>Precisa de atenção</span><strong>{counts.offline + counts.delayed + counts.unconfigured}</strong></article><article><span>Inativos</span><strong>{counts.inactive}</strong></article></div>
      <section className="sensor-map-panel" aria-label="Mapa de posicionamento dos sensores"><div className="sensor-map-heading"><div><h3>Posicionamento no talhão</h3><p>Selecione um marcador ou um dispositivo para centralizar o mapa.</p></div><span>{mapSensors.length} {mapSensors.length === 1 ? "sensor visível" : "sensores visíveis"}</span></div><FieldMap fields={fields} sensors={mapSensors} selectedSensorId={selectedSensorId} onSelectSensor={setSelectedSensorId} center={mapCenter}/><div className="sensor-map-caption"><div className="sensor-map-legend"><span><i className="sensor-dot simulated"/>Simulado</span><span><i className="sensor-dot real"/>Real</span><span><i className="sensor-dot inactive"/>Inativo</span></div><p aria-live="polite">{selectedSensor ? <><strong>{selectedSensor.device_id}</strong> · {selectedField?.name ?? "Talhão"} · {statusLabel(statusFor(selectedSensor))}{selectedReading?.ts ? ` · ${minuteLabel(selectedReading.ts)}` : ""} · {selectedSensor.location?.coordinates.map((value) => value.toFixed(5)).join(", ")}</> : "Nenhum sensor corresponde aos filtros atuais."}</p></div></section>
      <div className="sensor-toolbar"><label className="search-box"><Icon name="search" size={16}/><input aria-label="Buscar sensores ou talhões" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar dispositivo ou talhão…"/></label><div className="field-filter-chips" role="group" aria-label="Filtrar sensores por estado">{[{ value: "all", label: `Todos (${sensors.length})` }, { value: "online", label: `Online (${counts.online})` }, { value: "attention", label: `Atenção (${counts.offline + counts.delayed + counts.unconfigured})` }, { value: "inactive", label: `Inativos (${counts.inactive})` }].map((filter) => <button type="button" key={filter.value} aria-pressed={statusFilter === filter.value} className={statusFilter === filter.value ? "active" : ""} onClick={() => setStatusFilter(filter.value as typeof statusFilter)}>{filter.label}</button>)}</div></div>
      <div className="sensors-layout"><div className="sensor-table-wrap"><table className="sensor-table"><thead><tr><th>Conexão</th><th>Dispositivo</th><th>Origem</th><th>Talhão</th><th>Última leitura</th><th>Umidade</th><th>Ativo</th><th aria-label="Ações"/></tr></thead><tbody>{fields.map((field) => {
        const fieldSensors = sensors.filter((sensor) => sensor.field_id === field.id && sensorMatches(sensor, field));
        if (!fieldSensors.length) return null;
        return <Fragment key={field.id}><tr className="sensor-group-row"><td colSpan={8}><span className={`overview-field-color crop-${field.crop}`}/>{field.name} · {crops[field.crop]}<button type="button" className="text-button" onClick={() => onAddSensor(field.id)}>Vincular sensor</button></td></tr>{fieldSensors.map((sensor) => {
          const reading = readings.find((item) => item.sensor_id === sensor.id);
          const status = statusFor(sensor);
          const pending = pendingSensors.has(sensor.id);
          return <tr key={sensor.id}><td><span className={`sensor-status ${status === "inactive" ? "sensor-inactive" : status === "offline" ? "sensor-offline" : status === "delayed" ? "sensor-delayed" : status === "unconfigured" ? "sensor-unconfigured" : "sensor-online"}`}><i/>{pending ? "Salvando…" : statusLabel(status)}</span></td><td className="sensor-device-id"><button type="button" className="sensor-locate-button" onClick={() => setSelectedSensorId(sensor.id)}>{sensor.device_id}</button></td><td><span className={`sensor-source-badge ${sensor.source === "real" ? "real" : "simulated"}`}>{sensor.source === "real" ? "Real" : "Simulado"}</span></td><td>{field.name}</td><td>{minuteLabel(reading?.ts)}</td><td className="sensor-reading">{reading?.soil_moisture == null ? "—" : `${formatNumber(reading.soil_moisture, 1)}%`}</td><td><input className="switch" type="checkbox" checked={sensor.active} disabled={pending} aria-label={sensor.active ? `Desativar ${sensor.device_id}` : `Ativar ${sensor.device_id}`} onChange={() => void toggle(sensor)}/></td><td><details className="card-menu"><summary aria-label={`Ações de ${sensor.device_id}`}>⋯</summary><div><button type="button" onClick={() => onEdit(sensor)}>Editar</button><ConfirmAction prompt={`Remover o sensor “${sensor.device_id}” deste talhão?`} onConfirm={() => onDelete(sensor)} className="danger-link">Excluir</ConfirmAction></div></details></td></tr>;
        })}</Fragment>;
      })}{visibleCount === 0 && <tr><td colSpan={8} className="sensor-no-results">{sensors.length ? <>Nenhum sensor corresponde à busca ou ao estado selecionado. <button type="button" className="text-button" onClick={() => { setSearch(""); setStatusFilter("all"); }}>Limpar filtros</button></> : <>Nenhum sensor cadastrado. Use “Vincular sensor” no talhão que deseja monitorar.</>}</td></tr>}</tbody></table></div>
      <aside className="sensor-help-panel"><h3>Origem e consulta</h3><p>Sensores simulados recebem leituras geradas pelo worker. Sensores reais ficam sem ingestão até existir uma integração de telemetria. Este comando consulta a última leitura armazenada.</p><pre>{queryExample}</pre><button type="button" onClick={() => void copyQuery}>{copied ? "Comando copiado" : "Copiar comando"}</button>{copyError && <small role="status">Seu navegador bloqueou a cópia. Selecione o comando acima para copiá-lo.</small>}</aside></div>
    </>}
  </section>;
}

function AlertsFeed({ alerts, resolved, supported, fields, busyId, loading, checkedAt, onStatusChange, onRegister }: { alerts: Alert[]; resolved: Alert[]; supported: boolean; fields: Field[]; busyId: string; loading: boolean; checkedAt: number | null; onStatusChange: (alert: Alert, status: "open" | "resolved") => void; onRegister: (alert: Alert) => void }) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const items = tab === "open" ? alerts : resolved;
  const checkedLabel = checkedAt === null ? "Ainda não consultado" : new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(checkedAt);
  return <section className="panel alerts-feed"><div className="panel-heading"><div><span className="muted-eyebrow">CENTRO DE TRIAGEM</span><h2>Eventos</h2></div><span className="panel-refresh-state" aria-live="polite">{loading ? "Atualizando…" : checkedAt === null ? "Aguardando consulta" : `Consultado às ${checkedLabel}`}</span></div><div className="alert-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "open"} className={tab === "open" ? "active" : ""} onClick={() => setTab("open")}>Abertos ({alerts.length})</button><button type="button" role="tab" aria-selected={tab === "resolved"} className={tab === "resolved" ? "active" : ""} onClick={() => setTab("resolved")}>Resolvidos ({resolved.length})</button></div>{!supported ? <div className="integration-note"><Icon name="clock" size={16}/> O histórico de alertas não está disponível nesta versão da API.</div> : loading && items.length === 0 ? <div className="list-loading"><span className="skeleton"/>Consultando alertas…</div> : items.length === 0 ? <div className="alert-empty-line"><i/>{tab === "open" ? "Nenhum alerta aberto" : "Nenhum alerta resolvido"}{checkedAt !== null && <small>Consulta concluída às {checkedLabel}</small>}</div> : <div className="alerts-list">{items.map((alert) => { const metric = metrics.find((item) => item.value === alert.metric); const alertId = entityId(alert); const field = fields.find((item) => item.id === alert.field_id); return <article className={`alert-item alert-${alert.severity ?? "attention"}`} key={alertId}><div className="alert-copy"><div className="alert-title-row"><strong>{alert.title ?? `${metric?.label ?? alert.metric ?? "Leitura"} fora do limite`}</strong><span className={`alert-state-pill ${tab === "open" ? "open" : "resolved"}`}>{tab === "open" ? "Aberto" : "Resolvido"}</span></div><small>{field?.name ?? "Talhão"} · {dateLabel(alert.triggered_at ?? alert.created_at, true)}</small><p>{alert.message ?? `Leitura de ${formatNumber(alert.value ?? 0, 1)} ${metric?.unit ?? ""}; limite ${formatNumber(alert.threshold ?? 0, 1)} ${metric?.unit ?? ""}.`}</p><div className="alert-actions">{tab === "open" && field && <button type="button" className="button secondary compact-button" onClick={() => onRegister(alert)}>Registrar manejo</button>}<button type="button" className={`button compact-button ${tab === "open" ? "resolve-button" : "secondary"}`} disabled={busyId === alertId} onClick={() => onStatusChange(alert, tab === "open" ? "resolved" : "open")}>{busyId === alertId ? "Salvando…" : tab === "open" ? "Resolver alerta" : "Reabrir alerta"}</button></div></div></article>; })}</div>}</section>;
}

function Toast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(onDismiss, 4600); return () => window.clearTimeout(timer); }, [notice, onDismiss]);
  if (!notice) return null;
  return <div className={`toast toast-${notice.kind}`} role="status"><Icon name={notice.kind === "success" ? "check" : "bell"} size={17}/><span>{notice.text}</span><button type="button" className="icon-button" aria-label="Fechar mensagem" onClick={onDismiss}><Icon name="close" size={16}/></button></div>;
}

function ConfirmAction({ prompt, onConfirm, children, className = "" }: { prompt: string; onConfirm: () => void; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const promptId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);
  return <span className={`confirm-action ${className}`}><button ref={triggerRef} type="button" className="confirm-trigger" aria-expanded={open} aria-controls={open ? promptId : undefined} onClick={() => setOpen((value) => !value)}>{children}</button>{open && <span className="confirm-popover" role="alertdialog" aria-labelledby={promptId}><span id={promptId}>{prompt}</span><span className="confirm-popover-actions"><button ref={cancelRef} type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>Cancelar</button><button type="button" className="confirm-delete" onClick={() => { setOpen(false); onConfirm(); }}>Excluir</button></span></span>}</span>;
}

function ConfirmAction({ prompt, onConfirm, children, className = "", ariaLabel }: { prompt: string; onConfirm: () => void; children: ReactNode; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const accessibleName = ariaLabel ?? (typeof children === "string" ? children : prompt);
  return <span className={`confirm-action ${className}`}><button type="button" className="confirm-trigger" aria-label={accessibleName} onClick={() => setOpen((value) => !value)}>{children}</button>{open && <span className="confirm-popover" role="alertdialog"><span>{prompt}</span><span className="confirm-popover-actions"><button type="button" onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="confirm-delete" onClick={() => { setOpen(false); onConfirm(); }}>Excluir</button></span></span>}</span>;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [apiState, setApiState] = useState<ApiConnectionState>("connecting");
  const [lastApiSuccessAt, setLastApiSuccessAt] = useState<number | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmFieldsById, setFarmFieldsById] = useState<Record<string, Field[]>>({});
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [seasonTimeline, setSeasonTimeline] = useState<Season[]>([]);
  const [seasonTimelineLoading, setSeasonTimelineLoading] = useState(false);
  const [seasonRefresh, setSeasonRefresh] = useState(0);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [farmOperations, setFarmOperations] = useState<Operation[]>([]);
  const [farmOperationsLoading, setFarmOperationsLoading] = useState(false);
  const [farmOperationsError, setFarmOperationsError] = useState("");
  const [operationRefresh, setOperationRefresh] = useState(0);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [allSensors, setAllSensors] = useState<Sensor[]>([]);
  const [allSensorsLoading, setAllSensorsLoading] = useState(false);
  const [sensorReadings, setSensorReadings] = useState<Reading[]>([]);
  const [sensorRefresh, setSensorRefresh] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [moistureTrendSeries, setMoistureTrendSeries] = useState<SeriesPoint[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [metric, setMetric] = useState<(typeof metrics)[number]["value"]>("soil_moisture");
  const [days, setDays] = useState(7);
  const [farmModal, setFarmModal] = useState<FarmModal>(null);
  const [fieldModal, setFieldModal] = useState<FieldModal>(null);
  const [seasonModal, setSeasonModal] = useState<RecordModal<Season>>(null);
  const [operationModal, setOperationModal] = useState<RecordModal<Operation>>(null);
  const [operationTypePreset, setOperationTypePreset] = useState<Operation["type"]>("plantio");
  const [sensorModal, setSensorModal] = useState<RecordModal<Sensor>>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState("");
  const [seriesRetry, setSeriesRetry] = useState(0);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [resolvedAlerts, setResolvedAlerts] = useState<Alert[]>([]);
  const [alertsSupported, setAlertsSupported] = useState(true);
  const [alertRulesSupported, setAlertRulesSupported] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsCheckedAt, setAlertsCheckedAt] = useState<number | null>(null);
  const [alertsError, setAlertsError] = useState("");
  const [alertActionId, setAlertActionId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ruleCreateRequest, setRuleCreateRequest] = useState(0);
  const [farmSearch, setFarmSearch] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [cropFilter, setCropFilter] = useState("all");
  const [farmLoadError, setFarmLoadError] = useState("");
  const [farmRefreshing, setFarmRefreshing] = useState(false);
  const [fieldsLoadError, setFieldsLoadError] = useState("");

  const navigatePage = useCallback((next: Page) => {
    setPage(next);
    if (typeof window !== "undefined" && window.location.hash !== `#${next}`) {
      window.history.pushState({ agropulsePage: next }, "", `#${next}`);
    }
  }, []);

  const farm = farms.find((item) => item.id === selectedFarmId);
  const selectedField = fields.find((item) => item.id === selectedFieldId);
  const selectedMetric = metrics.find((item) => item.value === metric) ?? metrics[0];
  const fieldArea = fields.reduce((sum, item) => sum + (Number(item.area_ha) || 0), 0);
  const fieldCount = fields.length;
  useEffect(() => { setFieldSearch(""); setCropFilter("all"); }, [selectedFarmId]);
  const latest = readings[0];
  const filteredFarms = farms.filter((item) => `${item.name} ${item.municipality} ${item.state}`.toLocaleLowerCase("pt-BR").includes(farmSearch.toLocaleLowerCase("pt-BR")));
  const farmStats = Object.fromEntries(farms.map((item) => {
    const itemFields = farmFieldsById[item.id] ?? (item.id === selectedFarmId ? fields : undefined);
    return [item.id, itemFields ? { fields: itemFields.length, area: itemFields.reduce((sum, field) => sum + (Number(field.area_ha) || 0), 0) } : undefined];
  })) as Record<string, { fields: number; area: number } | undefined>;
  const filteredFields = fields.filter((item) => (cropFilter === "all" || item.crop === cropFilter) && `${item.name} ${crops[item.crop] ?? item.crop}`.toLocaleLowerCase("pt-BR").includes(fieldSearch.toLocaleLowerCase("pt-BR")));
  const moistureSparkline = moistureTrendSeries.slice(-7).map((point, index, points) => {
    const range = Math.max(...points.map((item) => item.value)) - Math.min(...points.map((item) => item.value)) || 1;
    return `${points.length < 2 ? 0 : (index / (points.length - 1)) * 100},${24 - ((point.value - Math.min(...points.map((item) => item.value))) / range) * 20}`;
  }).join(" ");

  const loadFarms = useCallback(async (auth: string) => {
    const list = (await apiFetch<(Farm & { _id?: string })[]>("/farms", auth)).map(normalizeFarm);
    setFarms(list);
    setSelectedFarmId((current) => list.some((item) => item.id === current) ? current : list[0]?.id ?? "");
    return list;
  }, []);

  const refreshFarms = async () => {
    setFarmRefreshing(true);
    setFarmLoadError("");
    try { await loadFarms(token!); }
    catch (error) { setFarmLoadError(detailOf(error)); }
    finally { setFarmRefreshing(false); }
  };

  const loadRecords = useCallback(async (auth: string, fieldId: string, isCurrent: () => boolean = () => true) => {
    setRecordsLoading(true); setRecordsError("");
    const query = `?field_id=${encodeURIComponent(fieldId)}`;
    const [seasonResult, operationResult, sensorResult] = await Promise.allSettled([
      apiFetch<(Season & { _id?: string })[]>(`/seasons${query}`, auth),
      apiFetch<(Operation & { _id?: string })[]>(`/operations${query}`, auth),
      apiFetch<(Sensor & { _id?: string })[]>(`/sensors${query}`, auth),
    ]);
    if (!isCurrent()) return;
    if (seasonResult.status === "fulfilled") setSeasons(seasonResult.value.map((item) => ({ ...item, id: entityId(item) })));
    else setSeasons([]);
    if (operationResult.status === "fulfilled") setOperations(operationResult.value.map((item) => ({ ...item, id: entityId(item) })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    else setOperations([]);
    if (sensorResult.status === "fulfilled") setSensors(sensorResult.value.map((item) => ({ ...item, id: entityId(item) })));
    else setSensors([]);
    const errors = [seasonResult, operationResult, sensorResult].filter((result) => result.status === "rejected");
    if (errors.length) setRecordsError(detailOf(errors[0].reason));
    setRecordsLoading(false);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    const syncPageFromLocation = () => {
      const key = window.location.hash.slice(1) as Page;
      if (pageKeys.has(key)) setPage(key);
    };
    syncPageFromLocation();
    window.addEventListener("hashchange", syncPageFromLocation);
    window.addEventListener("popstate", syncPageFromLocation);
    return () => {
      window.removeEventListener("hashchange", syncPageFromLocation);
      window.removeEventListener("popstate", syncPageFromLocation);
    };
  }, []);

  useEffect(() => {
    const onApiStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ reachable: boolean; updated: boolean; at: number }>).detail;
      setApiState(detail.reachable ? "online" : "offline");
      if (detail.updated) setLastApiSuccessAt(detail.at);
    };
    window.addEventListener("agropulse:api-status", onApiStatus);
    return () => window.removeEventListener("agropulse:api-status", onApiStatus);
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem("agropulse_token");
    setToken(null); setUser(null); setFarms([]); setFarmFieldsById({}); setFields([]); setSeasons([]); setOperations([]); setSensors([]); setSelectedFarmId(""); setSelectedFieldId("");
    setAccountOpen(false);
  }, []);

  useEffect(() => {
    const handleUnauthorized = (event: Event) => {
      const expiredToken = (event as CustomEvent<string>).detail;
      if (expiredToken && window.localStorage.getItem("agropulse_token") === expiredToken) {
        setSessionExpired(true);
        logout();
      }
    };
    window.addEventListener("agropulse:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("agropulse:unauthorized", handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    if (!token) return;
    const expiresAt = tokenExpirationMs(token);
    if (expiresAt === null) return;

    let timer: number | undefined;
    const checkExpiration = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
      if (window.localStorage.getItem("agropulse_token") !== token) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setSessionExpired(true);
        logout();
        return;
      }
      timer = window.setTimeout(checkExpiration, Math.min(remaining, 60_000));
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkExpiration();
    };

    checkExpiration();
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, [token, logout]);

  const updateAccount = async (body: AccountUpdate) => {
    if (!token) return;
    setSaving(true);
    try {
      const updated = await apiFetch<User>("/auth/me", token, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setUser(updated);
      setAccountOpen(false);
      setNotice({ kind: "success", text: "Seus dados foram atualizados." });
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (currentPassword: string) => {
    if (!token) return;
    setSaving(true);
    try {
      try {
        await apiFetch<void>("/auth/me", token, {
          method: "DELETE",
          body: JSON.stringify({ current_password: currentPassword }),
        });
      } catch (deleteError) {
        if (deleteError instanceof ApiError) throw deleteError;
        // A request may reach the server even when the browser loses its response.
        try {
          await apiFetch<User>("/auth/me", token);
        } catch (verificationError) {
          if (verificationError instanceof ApiError && verificationError.status === 401) {
            setSessionExpired(false);
            setAccountDeleted(true);
            logout();
            return;
          }
        }
        throw deleteError;
      }
      setSessionExpired(false);
      setAccountDeleted(true);
      logout();
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    let active = true;
    const auth = window.localStorage.getItem("agropulse_token");
    if (!auth) { setReady(true); return; }
    setToken(auth);
    Promise.all([apiFetch<User>("/auth/me", auth), loadFarms(auth)]).then(([profile]) => {
      if (active) { setUser(profile); setReady(true); }
    }).catch(() => {
      window.localStorage.removeItem("agropulse_token");
      if (active) { setToken(null); setUser(null); setReady(true); }
    });
    return () => { active = false; };
  }, [loadFarms]);

  useEffect(() => {
    if (!token || !selectedFarmId) { setFields([]); setSelectedFieldId(""); setFieldsLoadError(""); return; }
    let active = true; setLoadingWorkspace(true); setFieldsLoadError("");
    Promise.allSettled([apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(selectedFarmId)}`, token)]).then(([fieldsResult]) => {
      if (!active) return;
      if (fieldsResult.status === "fulfilled") {
        const list = fieldsResult.value.map(normalizeField); setFields(list);
        setFarmFieldsById((current) => ({ ...current, [selectedFarmId]: list }));
        setSelectedFieldId((current) => list.some((item) => item.id === current) ? current : list[0]?.id ?? "");
      } else { setFields([]); setSelectedFieldId(""); setFieldsLoadError(detailOf(fieldsResult.reason)); }
      setLoadingWorkspace(false);
    });
    return () => { active = false; };
  }, [token, selectedFarmId, workspaceVersion]);

  useEffect(() => {
    if (!token || page !== "farms" || !farms.length) { setFarmFieldsById({}); return; }
    let active = true;
    Promise.all(farms.map(async (item) => [item.id, await apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(item.id)}`, token).catch(() => [])] as const))
      .then((entries) => { if (active) setFarmFieldsById(Object.fromEntries(entries.map(([id, rows]) => [id, rows.map(normalizeField)]))); });
    return () => { active = false; };
  }, [token, page, farms]);

  useEffect(() => {
    if (!token || !selectedFieldId) { setSeasons([]); setOperations([]); setSensors([]); setRecordsError(""); setRecordsLoading(false); return; }
    let active = true;
    void loadRecords(token, selectedFieldId, () => active);
    return () => { active = false; };
  }, [token, selectedFieldId, loadRecords]);

  useEffect(() => {
    if (!token || (page !== "seasons" && page !== "operations") || !fields.length) { setSeasonTimeline([]); setSeasonTimelineLoading(false); return; }
    let active = true;
    setSeasonTimelineLoading(true);
    Promise.all(fields.map((field) => apiFetch<(Season & { _id?: string })[]>(`/seasons?field_id=${encodeURIComponent(field.id)}`, token).catch(() => [])))
      .then((items) => { if (active) setSeasonTimeline(items.flat().map((item) => ({ ...item, id: entityId(item) }))); })
      .finally(() => { if (active) setSeasonTimelineLoading(false); });
    return () => { active = false; };
  }, [token, page, fields, seasonRefresh]);

  useEffect(() => {
    if (!token || page !== "operations" || !fields.length) { setFarmOperations([]); setFarmOperationsLoading(false); setFarmOperationsError(""); return; }
    let active = true;
    setFarmOperationsLoading(true); setFarmOperationsError("");
    const loadFieldOperations = async (fieldId: string) => {
      const rows: (Operation & { _id?: string })[] = [];
      let offset = 0;
      while (active) {
        const pageRows = await apiFetch<(Operation & { _id?: string })[]>(`/operations?field_id=${encodeURIComponent(fieldId)}&limit=500&offset=${offset}`, token);
        rows.push(...pageRows);
        if (pageRows.length < 500) break;
        offset += pageRows.length;
      }
      return rows;
    };
    Promise.all(fields.map((item) => loadFieldOperations(item.id)))
      .then((rows) => { if (active) setFarmOperations(rows.flat().map((item) => ({ ...item, id: entityId(item) })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())); })
      .catch((error) => { if (active) { setFarmOperations([]); setFarmOperationsError(detailOf(error)); } })
      .finally(() => { if (active) setFarmOperationsLoading(false); });
    return () => { active = false; };
  }, [token, page, fields, operationRefresh]);

  useEffect(() => {
    if (!token || (page !== "sensors" && page !== "insights") || !fields.length) { setAllSensors([]); setSensorReadings([]); setAllSensorsLoading(false); return; }
    let active = true;
    setAllSensorsLoading(true);
    const loadFieldSensors = async (fieldId: string) => {
      const rows: (Sensor & { _id?: string })[] = [];
      let offset = 0;
      while (active) {
        const pageRows = await apiFetch<(Sensor & { _id?: string })[]>(`/sensors?field_id=${encodeURIComponent(fieldId)}&limit=500&offset=${offset}`, token);
        rows.push(...pageRows);
        if (pageRows.length < 500) break;
        offset += pageRows.length;
      }
      return rows;
    };
    Promise.all(fields.map(async (field) => {
      const [sensorRows, latestRows] = await Promise.all([
        loadFieldSensors(field.id).catch(() => []),
        apiFetch<Reading[]>(`/fields/${encodeURIComponent(field.id)}/readings/latest`, token).catch(() => []),
      ]);
      return { sensorRows, latestRows };
    })).then((rows) => { if (active) { setAllSensors(rows.flatMap((item) => item.sensorRows.map((sensor) => ({ ...sensor, id: entityId(sensor) })))); setSensorReadings(rows.flatMap((item) => item.latestRows)); } }).finally(() => { if (active) setAllSensorsLoading(false); });
    return () => { active = false; };
  }, [token, page, fields, sensorRefresh]);

  useEffect(() => {
    if (!token || !selectedFieldId) { setSeries([]); setReadings([]); setSeriesError(""); return; }
    let active = true; setSeriesLoading(true); setSeriesError("");
    const query = new URLSearchParams({ metric, unit: days <= 2 ? "hour" : "day", days: String(days) });
    Promise.allSettled([
      apiFetch<SeriesPoint[]>(`/analytics/fields/${encodeURIComponent(selectedFieldId)}/series?${query}`, token),
      apiFetch<Reading[]>(`/fields/${encodeURIComponent(selectedFieldId)}/readings/latest`, token),
    ]).then(([seriesResult, readingResult]) => {
      if (!active) return;
      if (seriesResult.status === "fulfilled") setSeries(seriesResult.value); else { setSeries([]); setSeriesError("Não foi possível carregar os dados dos sensores agora."); }
      if (readingResult.status === "fulfilled") setReadings(readingResult.value); else setReadings([]);
      setSeriesLoading(false);
    });
    return () => { active = false; };
  }, [token, selectedFieldId, metric, days, seriesRetry]);

  useEffect(() => {
    if (!token || !selectedFieldId) { setMoistureTrendSeries([]); return; }
    let active = true;
    const query = new URLSearchParams({ metric: "soil_moisture", unit: "day", days: "7" });
    apiFetch<SeriesPoint[]>(`/analytics/fields/${encodeURIComponent(selectedFieldId)}/series?${query}`, token)
      .then((result) => { if (active) setMoistureTrendSeries(result); })
      .catch(() => { if (active) setMoistureTrendSeries([]); });
    return () => { active = false; };
  }, [token, selectedFieldId]);

  useEffect(() => {
    if (!token || !selectedFieldId) return;
    let active = true;
    const refreshLatest = () => {
      void apiFetch<Reading[]>(`/fields/${encodeURIComponent(selectedFieldId)}/readings/latest`, token)
        .then((result) => { if (active) setReadings(result); })
        .catch(() => { /* Preserve the last successful reading during a temporary outage. */ });
    };
    const timer = window.setInterval(refreshLatest, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token, selectedFieldId]);

  const loadAlerts = useCallback(async (auth: string, currentFields: Field[]) => {
    if (!currentFields.length) { setAlerts([]); setResolvedAlerts([]); setAlertRules([]); setAlertsSupported(true); setAlertRulesSupported(true); setAlertsError(""); setAlertsLoading(false); setAlertsCheckedAt(null); return; }
    setAlertsLoading(true);
    const [rulesResult, alertsResult, resolvedResult] = await Promise.allSettled([
      apiFetch<AlertRule[]>("/alert-rules", auth),
      apiFetch<Alert[]>("/alerts?status=open", auth),
      apiFetch<Alert[]>("/alerts?status=resolved", auth),
    ]);
    const isUnsupported = (result: PromiseSettledResult<unknown>) => result.status === "rejected" && /404|405|not found|não foi possível concluir/i.test(detailOf(result.reason));
    setAlertRulesSupported(!isUnsupported(rulesResult));
    setAlertsSupported(!isUnsupported(alertsResult) && !isUnsupported(resolvedResult));
    const fieldIds = new Set(currentFields.map((item) => item.id));
    if (rulesResult.status === "fulfilled") setAlertRules(rulesResult.value.map(normalizeAlert).filter((item) => fieldIds.has(item.field_id)));
    else setAlertRules([]);
    if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value.map(normalizeAlert).filter((item) => item.field_id ? fieldIds.has(item.field_id) : true));
    else setAlerts([]);
    if (resolvedResult.status === "fulfilled") setResolvedAlerts(resolvedResult.value.map(normalizeAlert).filter((item) => item.field_id ? fieldIds.has(item.field_id) : true));
    else setResolvedAlerts([]);
    const failures = [
      rulesResult.status === "rejected" && !isUnsupported(rulesResult) ? `regras: ${detailOf(rulesResult.reason)}` : "",
      alertsResult.status === "rejected" && !isUnsupported(alertsResult) ? `alertas abertos: ${detailOf(alertsResult.reason)}` : "",
      resolvedResult.status === "rejected" && !isUnsupported(resolvedResult) ? `histórico: ${detailOf(resolvedResult.reason)}` : "",
    ].filter(Boolean);
    setAlertsError(failures.length ? `Atualização incompleta — ${failures.join(" · ")}` : "");
    setAlertsCheckedAt(Date.now());
    setAlertsLoading(false);
  }, []);

  useEffect(() => { if (token && fields.length) void loadAlerts(token, fields); }, [token, fields, loadAlerts]);

  useEffect(() => {
    if (!token || page !== "alerts" || !fields.length) return;
    const timer = window.setInterval(() => { void loadAlerts(token, fields); }, 30_000);
    return () => window.clearInterval(timer);
  }, [token, page, fields, loadAlerts]);

  useEffect(() => {
    if (!token || (page !== "sensors" && page !== "insights") || !fields.length) return;
    const timer = window.setInterval(() => setSensorRefresh((version) => version + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [token, page, fields]);

  const setAlertStatus = async (alert: Alert, status: "open" | "resolved") => {
    if (!token) return;
    const alertId = entityId(alert);
    if (!alertId) return;
    setAlertActionId(alertId);
    try {
      await apiFetch<Alert>(`/alerts/${encodeURIComponent(alertId)}`, token, { method: "PATCH", body: JSON.stringify({ status }) });
      await loadAlerts(token, fields);
      setNotice({ kind: "success", text: status === "resolved" ? "Alerta resolvido e arquivado." : "Alerta reaberto." });
    } catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
    finally { setAlertActionId(""); }
  };

  const registerAlertOperation = (alert: Alert) => {
    if (!alert.field_id) return;
    setSelectedFieldId(alert.field_id);
    setOperationTypePreset(alert.metric === "soil_moisture" ? "irrigacao" : "plantio");
    navigatePage("operations");
    setOperationModal({ mode: "create" });
  };

  const signIn = (auth: string, profile: User) => {
    window.localStorage.setItem("agropulse_token", auth); setSessionExpired(false); setAccountDeleted(false); setToken(auth); setUser(profile); setReady(false);
    loadFarms(auth).then(() => { setReady(true); }).catch((error) => { setReady(true); setFarmLoadError(detailOf(error)); });
  };

  const saveFarm = async (body: object) => {
    if (!token) return;
    setSaving(true);
    try {
      const saved = farmModal?.mode === "edit" && farmModal.farm ? await apiFetch<Farm>(`/farms/${encodeURIComponent(farmModal.farm.id)}`, token, { method: "PATCH", body: JSON.stringify(body) }) : await apiFetch<Farm>("/farms", token, { method: "POST", body: JSON.stringify(body) });
      await loadFarms(token); if (saved) setSelectedFarmId(entityId(saved)); setFarmModal(null); setNotice({ kind: "success", text: farmModal?.mode === "edit" ? "Fazenda atualizada com sucesso." : "Fazenda cadastrada com sucesso." });
    } finally { setSaving(false); }
  };
  const deleteFarm = async (item: Farm) => {
    if (!token) return;
    try { await apiFetch<void>(`/farms/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); await loadFarms(token); setNotice({ kind: "success", text: "Fazenda excluída." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveField = async (body: object) => {
    if (!token) return;
    setSaving(true);
    try {
      const saved = fieldModal?.mode === "edit" && fieldModal.field ? await apiFetch<Field>(`/fields/${encodeURIComponent(fieldModal.field.id)}`, token, { method: "PATCH", body: JSON.stringify(body) }) : await apiFetch<Field>("/fields", token, { method: "POST", body: JSON.stringify(body) });
      const list = (await apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(selectedFarmId)}`, token)).map(normalizeField); setFields(list); setFarmFieldsById((current) => ({ ...current, [selectedFarmId]: list })); if (saved) setSelectedFieldId(entityId(saved)); setFieldModal(null); setNotice({ kind: "success", text: fieldModal?.mode === "edit" ? "Talhão atualizado com sucesso." : "Talhão cadastrado com sucesso." });
    } finally { setSaving(false); }
  };
  const deleteField = async (item: Field) => {
    if (!token) return;
    try { await apiFetch<void>(`/fields/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); const list = (await apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(selectedFarmId)}`, token)).map(normalizeField); setFields(list); setFarmFieldsById((current) => ({ ...current, [selectedFarmId]: list })); setSelectedFieldId(list[0]?.id ?? ""); setNotice({ kind: "success", text: "Talhão excluído." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveSeason = async (body: object) => {
    if (!token || !selectedFieldId || !seasonModal) return;
    setSaving(true);
    try {
      if (seasonModal.mode === "edit") {
        const { field_id: _fieldId, ...changes } = body as Record<string, unknown>;
        await apiFetch<Season>(`/seasons/${encodeURIComponent(seasonModal.record.id)}`, token, { method: "PATCH", body: JSON.stringify(changes) });
      } else await apiFetch<Season>("/seasons", token, { method: "POST", body: JSON.stringify(body) });
      await loadRecords(token, selectedFieldId); setSeasonModal(null); setNotice({ kind: "success", text: seasonModal.mode === "edit" ? "Safra atualizada." : "Safra planejada." });
      setSeasonRefresh((version) => version + 1);
    } finally { setSaving(false); }
  };
  const deleteSeason = async (item: Season) => {
    if (!token || !selectedFieldId) return;
    try { await apiFetch<void>(`/seasons/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); await loadRecords(token, selectedFieldId); setSeasonRefresh((version) => version + 1); setNotice({ kind: "success", text: "Safra excluída." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveOperation = async (body: object, files: File[] = [], idempotencyKey?: string) => {
    if (!token || !operationModal) return;
    const operationBody = body as Record<string, unknown>;
    const fieldId = String(operationBody.field_id ?? selectedFieldId);
    setSaving(true);
    try {
      const saved = operationModal.mode === "edit"
        ? await apiFetch<Operation>(`/operations/${encodeURIComponent(operationModal.record.id)}`, token, { method: "PATCH", body: JSON.stringify(body) })
        : await apiFetch<Operation>("/operations", token, { method: "POST", body: JSON.stringify(body), headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined });
      setSelectedFieldId(fieldId);
      let attachmentFailure = false;
      for (const file of files) {
        try {
          await apiFetch<OperationAttachment>(`/operations/${encodeURIComponent(saved.id)}/attachments`, token, {
            method: "POST",
            headers: { "Content-Type": file.type, "X-Filename": encodeURIComponent(file.name) },
            body: file,
          });
        } catch { attachmentFailure = true; }
      }
      await loadRecords(token, fieldId);
      setOperationRefresh((version) => version + 1);
      setOperationModal(null);
      setNotice(attachmentFailure
        ? { kind: "error", text: "A operação foi salva, mas não foi possível enviar um ou mais anexos." }
        : { kind: "success", text: operationModal.mode === "edit" ? "Operação atualizada." : "Operação registrada." });
    } finally { setSaving(false); }
  };
  const deleteOperation = async (item: Operation) => {
    if (!token) return;
    try { await apiFetch<void>(`/operations/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); await loadRecords(token, item.field_id); setOperationRefresh((version) => version + 1); setNotice({ kind: "success", text: "Operação excluída." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveSensor = async (body: object) => {
    const bodyFieldId = (body as { field_id?: unknown }).field_id;
    const targetFieldId = typeof bodyFieldId === "string" ? bodyFieldId : selectedFieldId;
    if (!token || !targetFieldId || !sensorModal) return;
    setSaving(true);
    try {
      if (sensorModal.mode === "edit") await apiFetch<Sensor>(`/sensors/${encodeURIComponent(sensorModal.record.id)}`, token, { method: "PATCH", body: JSON.stringify(body) });
      else await apiFetch<Sensor>("/sensors", token, { method: "POST", body: JSON.stringify(body) });
      setSelectedFieldId(targetFieldId); await loadRecords(token, targetFieldId); setSensorRefresh((version) => version + 1); setSensorModal(null); setNotice({ kind: "success", text: sensorModal.mode === "edit" ? "Sensor atualizado." : "Sensor vinculado ao talhão." });
    } finally { setSaving(false); }
  };
  const toggleSensor = async (sensor: Sensor) => {
    if (!token) return;
    try { await apiFetch<Sensor>(`/sensors/${encodeURIComponent(sensor.id)}`, token, { method: "PATCH", body: JSON.stringify({ active: !sensor.active }) }); await loadRecords(token, sensor.field_id); setSensorRefresh((version) => version + 1); setNotice({ kind: "success", text: sensor.active ? "Sensor desativado." : "Sensor ativado." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const deleteSensor = async (sensor: Sensor) => {
    if (!token) return;
    try { await apiFetch<void>(`/sensors/${encodeURIComponent(sensor.id)}`, token, { method: "DELETE" }); await loadRecords(token, sensor.field_id); setSensorRefresh((version) => version + 1); setNotice({ kind: "success", text: "Sensor removido." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveRule = async (rule: AlertRule | undefined, body: object) => {
    if (!token) return;
    setSaving(true);
    try {
      const path = rule ? `/alert-rules/${encodeURIComponent(entityId(rule))}` : "/alert-rules";
      await apiFetch<AlertRule>(path, token, { method: rule ? "PATCH" : "POST", body: JSON.stringify(body) });
      await loadAlerts(token, fields);
      setNotice({ kind: "success", text: rule ? "Regra de alerta atualizada." : "Regra de alerta criada." });
    } finally { setSaving(false); }
  };
  const toggleRuleGroup = async (group: AlertRule[]) => { if (!token || !group.length) return; const active = !group.every((rule) => rule.active !== false); try { await Promise.all(group.map((rule) => apiFetch<AlertRule>(`/alert-rules/${encodeURIComponent(entityId(rule))}`, token, { method: "PATCH", body: JSON.stringify({ active }) }))); await loadAlerts(token, fields); } catch (error) { setNotice({ kind: "error", text: detailOf(error) }); } };
  const deleteRuleGroup = async (group: AlertRule[]) => { if (!token || !group.length) return; try { await Promise.all(group.map((rule) => apiFetch<void>(`/alert-rules/${encodeURIComponent(entityId(rule))}`, token, { method: "DELETE" }))); await loadAlerts(token, fields); setNotice({ kind: "success", text: "Regra removida." }); } catch (error) { setNotice({ kind: "error", text: detailOf(error) }); } };

  if (!ready) return <main className="boot-screen"><Brand/><span className="skeleton"/></main>;
  if (!token || !user) return <AuthScreen onAuthenticated={signIn} sessionExpired={sessionExpired} accountDeleted={accountDeleted}/>;

  const addFarm = () => setFarmModal({ mode: "create" });
  const addField = () => { if (!farm) { setNotice({ kind: "error", text: "Cadastre ou selecione uma fazenda primeiro." }); return; } setFieldModal({ mode: "create" }); };
  const addSeason = () => selectedFieldId ? setSeasonModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de planejar uma safra." });
  const addOperation = () => { setOperationTypePreset("plantio"); selectedFieldId ? setOperationModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de registrar uma operação." }); };
  const addQuickOperation = (type: Operation["type"]) => { setOperationTypePreset(type); selectedFieldId ? setOperationModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de registrar uma operação." }); };
  const addSensor = () => selectedFieldId ? setSensorModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de vincular um sensor." });
  const setupFields = () => farm ? addField() : addFarm();
  const addSensorToField = (fieldId: string) => { setSelectedFieldId(fieldId); setSensorModal({ mode: "create" }); };
  const requiresField = page === "seasons" || page === "operations" || page === "insights" || page === "sensors" || page === "alerts";
  const navAdd = () => {
    if (requiresField && !fields.length) return setupFields();
    if (page === "fields") return addField();
    if (page === "seasons") return addSeason();
    if (page === "operations") return addOperation();
    if (page === "insights") return addQuickOperation("irrigacao");
    if (page === "sensors") return addSensor();
    if (page === "alerts") return setRuleCreateRequest((value) => value + 1);
    if (page === "farms") return addFarm();
  };
  const mapCenter: [number, number] | undefined = farm ? [farm.location.coordinates[1], farm.location.coordinates[0]] : undefined;
  const cropBreakdown = summary.length ? summary : Object.entries(fields.reduce<Record<string, { fields: number; area_ha: number }>>((acc, item) => { acc[item.crop] ??= { fields: 0, area_ha: 0 }; acc[item.crop].fields += 1; acc[item.crop].area_ha += item.area_ha; return acc; }, {})).map(([crop, data]) => ({ crop, ...data }));
  const operationDialogField = operationModal?.mode === "edit" ? fields.find((item) => item.id === operationModal.record.field_id) ?? selectedField : selectedField;

  return <div className="app-shell"><Sidebar page={page} setPage={navigatePage} farms={farms} selectedFarmId={selectedFarmId} onFarmSelect={setSelectedFarmId} user={user} onLogout={logout} onAccount={() => setAccountOpen(true)} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} alertCount={alertsSupported ? alerts.length : 0}/><main className="main-area"><Header page={page} onAdd={navAdd} onMenu={() => setMobileOpen(true)} hasFields={fields.length > 0} hasFarm={Boolean(farm)} apiState={apiState} lastUpdated={lastApiSuccessAt}/><div className="page-content">
    {(farmLoadError || fieldsLoadError || workspaceError || recordsError || alertsError) && <div className="workspace-warning" role="alert"><Icon name="bell" size={17}/><span>{farmLoadError || fieldsLoadError || workspaceError || recordsError || alertsError}</span><button type="button" className="text-button" onClick={() => { if (farmLoadError) { setFarmLoadError(""); void loadFarms(token); } else if (recordsError && selectedFieldId) { void loadRecords(token, selectedFieldId); } else { setFieldsLoadError(""); setWorkspaceVersion((version) => version + 1); } }}>Tentar novamente</button></div>}
    {page === "overview" && <>
      <section className="welcome-row"><div><h2>{farm?.name ?? "Visão geral"}</h2><p className="welcome-copy">{farm ? `${farmPlace(farm)} · ${formatNumber(fieldArea, 1)} ha · ${fieldCount} ${fieldCount === 1 ? "talhão" : "talhões"}` : "Acompanhe suas propriedades e áreas produtivas."}</p></div></section>
      {!farms.length ? farmLoadError ? <EmptyState title="Não foi possível carregar as fazendas" body={farmLoadError} action="Tentar novamente" icon="farm" onAction={() => { setFarmLoadError(""); void loadFarms(token); }}/> : <EmptyState title="Sua operação começa com uma fazenda" body="Cadastre sua primeira propriedade para organizar os talhões e acompanhar as informações da lavoura." action="Cadastrar fazenda" onAction={addFarm}/> : <>
        <section className="dashboard-hero"><div className="dashboard-hero-copy"><span className="hero-live"><i/> DADOS DE CAMPO EM UM SÓ LUGAR</span><h2>Da leitura à decisão.<br/><span>Com contexto.</span></h2><p>Conecte o que acontece no talhão ao histórico de manejo, aos sensores e ao clima.</p><div className="dashboard-hero-actions"><button type="button" className="button hero-primary" onClick={() => navigatePage("insights")}>Explorar inteligência <Icon name="chevron" size={16}/></button><button type="button" className="button hero-secondary" onClick={() => addQuickOperation("irrigacao")}><Icon name="droplet" size={16}/> Registrar irrigação</button></div></div><div className="dashboard-hero-reading"><span>LEITURA SELECIONADA</span><strong>{latest?.soil_moisture == null ? "—" : `${formatNumber(latest.soil_moisture, 1)}%`}</strong><small>{selectedField?.name ?? "Selecione um talhão"}{latest ? ` · ${dateLabel(latest.ts, true)}` : " · aguardando telemetria"}</small><i className="dashboard-reading-line" style={{ background: latest?.soil_moisture == null ? "#ffffff35" : `linear-gradient(90deg,#d1f278 ${Math.max(0, Math.min(latest.soil_moisture, 100))}%,#ffffff35 ${Math.max(0, Math.min(latest.soil_moisture, 100))}%)` }}/></div><small className="dashboard-hero-caption">{farmPlace(farm)} · {fieldCount} áreas monitoradas</small></section>
        {alerts.length > 0 && <div className="overview-alert-banner" role="status"><span className="alert-banner-dot"/><strong>{alerts.length} {alerts.length === 1 ? "alerta aberto" : "alertas abertos"}</strong><span>Há condições que precisam de atenção.</span><button type="button" className="text-button" onClick={() => navigatePage("alerts")}>Ver alertas <Icon name="chevron" size={15}/></button></div>}
        <section className={`metrics-grid ${alerts.length > 0 ? "has-alerts" : ""}`}><MetricCard label="Área monitorada" value={formatNumber(fieldArea, 1)} unit="ha" caption={`${fieldCount} ${fieldCount === 1 ? "talhão" : "talhões"} cadastrados`}/><MetricCard label="Talhões cadastrados" value={String(fieldCount)} caption={farmPlace(farm)}/><MetricCard label="Umidade do solo" value={latest?.soil_moisture == null ? "—" : formatNumber(latest.soil_moisture, 1)} unit={latest?.soil_moisture == null ? "" : "%"} caption={latest ? `Atualizado em ${dateLabel(latest.ts, true)}` : "Aguardando leitura dos sensores"} detail={<><svg className="metric-sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Tendência recente da umidade do solo"><polyline points={moistureSparkline} fill="none" stroke="var(--chart-sensor-1)" strokeWidth="2" vectorEffect="non-scaling-stroke"/></svg><div className="moisture-threshold"><span/><i>Limite 20%</i></div></>}/><MetricCard label="Alertas abertos" value={alertsSupported ? String(alerts.length) : "—"} caption={alertsSupported ? alerts.length ? "Verifique os eventos ativos" : "" : "Integração indisponível"} detail={!alerts.length && alertsSupported ? <span className="metric-ok-caption"><i/>Nenhum alerta</span> : undefined} tone={alerts.length ? "alerts-hot" : ""}/></section>
        <div className="dashboard-grid"><section className="panel map-panel"><div className="panel-heading"><div><h2>Mapa dos talhões</h2><p>{farmPlace(farm)}</p></div><button type="button" className="subtle-action" onClick={() => navigatePage("fields")}>Ver talhões <Icon name="chevron" size={15}/></button></div><FieldMap fields={fields} selectedFieldId={selectedFieldId} onSelect={setSelectedFieldId} center={mapCenter}/><div className="map-legend">{cropBreakdown.map((item) => <span key={item.crop}><i className={`legend-${item.crop}`}/>{crops[item.crop as Field["crop"]] ?? item.crop}</span>)}</div></section>
          <div className="overview-side-stack"><section className="panel crop-panel"><div className="panel-heading"><div><h2>Áreas por cultura</h2></div></div>{cropBreakdown.length ? <><div className="crop-stacked-track">{cropBreakdown.map((item) => { const total = cropBreakdown.reduce((sum, row) => sum + row.area_ha, 0) || 1; const percent = Math.max(item.area_ha / total * 100, 1); return <span key={item.crop} className={`crop-segment crop-${item.crop}`} style={{ width: `${percent}%` }} title={`${crops[item.crop as Field["crop"]] ?? item.crop}: ${formatNumber(item.area_ha, 1)} ha`}/>; })}</div><div className="crop-list">{cropBreakdown.map((item) => { const total = cropBreakdown.reduce((sum, row) => sum + row.area_ha, 0) || 1; const percent = Math.round(item.area_ha / total * 100); return <div className="crop-row" key={item.crop}><div className="crop-row-top"><span><i className={`crop-dot crop-${item.crop}`}/>{crops[item.crop as Field["crop"]] ?? item.crop}</span><strong>{formatNumber(item.area_ha, 1)} ha · {percent}%</strong></div></div>; })}</div></> : <div className="mini-empty">Cadastre os talhões para ver a distribuição por cultura.</div>}</section>
            <section className="panel quick-fields"><div className="panel-heading"><h2>Talhões</h2><button type="button" className="subtle-action" onClick={() => navigatePage("fields")}>Ver todos <Icon name="chevron" size={15}/></button></div>{fields.slice(0, 5).map((item) => <button type="button" className={`overview-field-row ${selectedFieldId === item.id ? "selected" : ""}`} aria-pressed={selectedFieldId === item.id} key={item.id} onClick={() => setSelectedFieldId(item.id)}><span className={`overview-field-color crop-${item.crop}`}/><span className="overview-field-name">{item.name}</span><span className="overview-field-area">{formatNumber(item.area_ha, 1)} ha</span><span className="overview-field-status" aria-hidden="true">{selectedFieldId === item.id ? "Selecionado" : "Ver leitura"}</span></button>)}{!fields.length && <p className="small-empty">Nenhum talhão cadastrado nesta fazenda.</p>}</section></div>
        </div>
        <section className="panel chart-panel"><div className="panel-heading chart-heading"><div><h2>Leituras dos sensores</h2><p>{selectedField ? `${selectedField.name} · ${farm?.name ?? ""}` : "Selecione um talhão para visualizar os dados"}</p></div><div className="chart-controls"><div className="segmented-control" role="group" aria-label="Métrica do gráfico">{metrics.map((item) => <button key={item.value} type="button" className={metric === item.value ? "active" : ""} onClick={() => setMetric(item.value)}>{item.label.replace("Temperatura do ", "Temp. ").replace(" acumulada", "")}</button>)}</div><div className="segmented-control period-control" role="group" aria-label="Período do gráfico">{[{ value: 1, label: "24h" }, { value: 7, label: "7d" }, { value: 30, label: "30d" }].map((item) => <button key={item.value} type="button" className={days === item.value ? "active" : ""} onClick={() => setDays(item.value)}>{item.label}</button>)}</div></div></div>{seriesLoading ? <div className="chart-loading"><span className="skeleton"/>Carregando leituras…</div> : seriesError ? <div className="chart-inline-error"><Icon name="activity" size={18}/><span>{seriesError}</span></div> : <TelemetryChart data={series} unit={selectedMetric.unit} bucketUnit={days === 1 ? "hour" : "day"}/>}</section>
      </>}
      {selectedField && <div className="insights-grid"><WeatherPanel token={token} fieldId={selectedField.id}/><ProductionRankingPanel token={token} crop={selectedField.crop} state={farm?.state} municipality={farm?.municipality}/></div>}
    </>}
    {page === "farms" && <section className="collection-page"><div className="collection-heading"><div><h2>Fazendas</h2><span>Gerencie suas propriedades e acompanhe a área produtiva.</span></div><label className="search-box"><Icon name="search" size={17}/><input aria-label="Buscar fazendas" value={farmSearch} onChange={(event) => setFarmSearch(event.target.value)} placeholder="Buscar fazenda…"/></label></div>{farmLoadError ? <EmptyState title="Não foi possível carregar as fazendas" body={farmLoadError} action="Tentar novamente" icon="farm" onAction={() => { setFarmLoadError(""); void loadFarms(token); }}/> : filteredFarms.length ? <div className="farm-grid">{filteredFarms.map((item) => { const stats = farmStats[item.id]; const isSelected = item.id === selectedFarmId; const count = stats?.fields ?? (isSelected ? fields.length : 0); const area = stats?.area ?? (isSelected ? fieldArea : 0); return <FarmCard key={item.id} farm={item} fields={farmFieldsById[item.id] ?? (isSelected ? fields : [])} fieldsCount={count} area={area} statsKnown={Boolean(stats) || isSelected} onSelect={() => { setSelectedFarmId(item.id); navigatePage("overview"); }} onEdit={() => setFarmModal({ mode: "edit", farm: item })} onDelete={() => void deleteFarm(item)}/>; })}<button type="button" className="farm-add-card" onClick={addFarm}><Icon name="plus"/> Adicionar outra fazenda</button></div> : <EmptyState title={farms.length ? "Nenhuma fazenda encontrada" : "Cadastre sua primeira fazenda"} body={farms.length ? "Tente buscar por outro nome ou município." : "Adicione uma propriedade para começar a mapear sua operação."} action={farms.length ? "Limpar busca" : "Cadastrar fazenda"} onAction={farms.length ? () => setFarmSearch("") : addFarm}/>}</section>}
    {page === "fields" && <section className="collection-page fields-page">
      <div className="collection-heading"><div><h2>Talhões</h2><span>Organize suas culturas e acompanhe os limites de cada área.</span></div></div>
      {fieldsLoadError ? <EmptyState title="Não foi possível carregar os talhões" body={fieldsLoadError} action="Atualizar" icon="field" onAction={() => { setFieldsLoadError(""); setWorkspaceVersion((version) => version + 1); }}/> : !farms.length ? <EmptyState title="Nenhuma fazenda cadastrada" body="Cadastre uma fazenda antes de adicionar talhões." action="Cadastrar fazenda" onAction={addFarm}/> : <div className="fields-layout">
        <div className="panel all-fields-panel"><div className="fields-list-heading"><div><h2>{fieldCount} talhões · {formatNumber(fieldArea, 1)} ha</h2><span>{filteredFields.length} exibidos nesta fazenda</span></div><label className="search-box small-search"><Icon name="search" size={16}/><input aria-label="Buscar talhões" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Buscar talhão"/></label></div>
          <div className="crop-filter-tabs" role="group" aria-label="Filtrar talhões por cultura">{[{ value: "all", label: "Todas" }, ...Object.entries(crops).map(([value, label]) => ({ value, label }))].map((item) => <button type="button" aria-pressed={cropFilter === item.value} key={item.value} className={cropFilter === item.value ? "active" : ""} onClick={() => setCropFilter(item.value)}>{item.label}</button>)}</div>
          {loadingWorkspace ? <div className="list-loading"><span className="skeleton"/>Carregando talhões…</div> : filteredFields.length ? filteredFields.map((item) => <FieldRow key={item.id} field={item} farm={farm} selected={item.id === selectedFieldId} onSelect={() => setSelectedFieldId(item.id)} onEdit={() => setFieldModal({ mode: "edit", field: item })} onDelete={() => void deleteField(item)}/>) : <div className="small-empty">{fields.length ? <><span>Nenhum talhão corresponde aos filtros.</span><button type="button" className="text-button" onClick={() => { setCropFilter("all"); setFieldSearch(""); }}>Limpar busca e cultura</button></> : "Esta fazenda ainda não possui talhões."}</div>}
        </div>
        <div className="fields-map-panel"><div className="fields-map-toolbar"><button type="button" className="button secondary compact-button" disabled={!farm} onClick={addField}><Icon name="plus" size={15}/>Desenhar talhão</button></div><FieldMap fields={fields} selectedFieldId={selectedFieldId} onSelect={setSelectedFieldId} center={mapCenter}/>{selectedField && <div className={`fields-selection-card crop-border-${selectedField.crop}`}><h3>{selectedField.name}</h3><p>{crops[selectedField.crop]} · {formatNumber(selectedField.area_ha, 1)} ha</p><span>{latest?.soil_moisture == null ? "Umidade sem leitura recente" : `Umidade ${formatNumber(latest.soil_moisture, 1)}% · ${latest.soil_moisture < 20 ? "Atenção" : "Dentro do limite"}`}</span><p>{sensors.filter((item) => item.field_id === selectedField.id).length} sensores vinculados · {seasons.find((item) => item.status === "em_andamento")?.label ?? "Sem safra ativa"}</p><div className="fields-selection-actions"><button type="button" className="button secondary compact-button" onClick={() => setFieldModal({ mode: "edit", field: selectedField })}>Editar</button><ConfirmAction prompt={`Excluir o talhão “${selectedField.name}”?`} onConfirm={() => void deleteField(selectedField)} className="danger-link">Excluir</ConfirmAction></div></div>}</div>
      </div>}
    </section>}
    {page === "seasons" && <SeasonCollection key={selectedFarmId} fields={fields} selectedFieldId={selectedFieldId} seasons={seasonTimeline} loading={recordsLoading || seasonTimelineLoading} error={recordsError} onFieldChange={setSelectedFieldId} onPlanField={(fieldId) => { setSelectedFieldId(fieldId); setSeasonModal({ mode: "create" }); }} onEdit={(record) => { setSelectedFieldId(record.field_id); setSeasonModal({ mode: "edit", record }); }} onDelete={(record) => void deleteSeason(record)} onSetupFields={setupFields} setupLabel={farm ? "Cadastrar talhão" : "Cadastrar fazenda"}/>}
    {page === "operations" && <OperationCollection key={selectedFarmId} field={selectedField} fields={fields} operations={farmOperations} seasons={seasonTimeline} loading={farmOperationsLoading} error={farmOperationsError} onQuickAdd={addQuickOperation} onEdit={(record) => { setSelectedFieldId(record.field_id); setOperationModal({ mode: "edit", record }); }} onDelete={(record) => void deleteOperation(record)} onSetupFields={setupFields} setupLabel={farm ? "Cadastrar talhão" : "Cadastrar fazenda"} token={token}/>}
    {page === "insights" && <FieldIntelligence key={selectedFarmId} fields={fields} selectedField={selectedField} selectedFieldId={selectedFieldId} onSelectField={setSelectedFieldId} onLogIrrigation={() => fields.length ? addQuickOperation("irrigacao") : farm ? addField() : addFarm()} onSetup={farm ? addField : addFarm} setupLabel={farm ? "Cadastrar talhão" : "Cadastrar fazenda"} sensors={allSensors} readings={sensorReadings} alerts={alerts} alertRules={alertRules} loading={loadingWorkspace || allSensorsLoading} error={fieldsLoadError} metric={metric} days={days} series={series} seriesLoading={seriesLoading} seriesError={seriesError} chart={<TelemetryChart data={series} unit={selectedMetric.unit} bucketUnit={days === 1 ? "hour" : "day"}/>} onMetricChange={(value) => setMetric(value)} onDaysChange={setDays} token={token} farmName={farm?.name ?? ""} municipality={farm?.municipality} state={farm?.state}/>}
    {page === "sensors" && <SensorCollection key={selectedFarmId} fields={fields} sensors={allSensors} readings={sensorReadings} loading={recordsLoading || allSensorsLoading} error={recordsError} onEdit={(record) => { setSelectedFieldId(record.field_id); setSensorModal({ mode: "edit", record }); }} onToggle={toggleSensor} onDelete={(record) => void deleteSensor(record)} onSetupFields={setupFields} setupLabel={farm ? "Cadastrar talhão" : "Cadastrar fazenda"} onAddSensor={addSensorToField}/>}
    {page === "alerts" && <section className="collection-page"><div className="collection-heading"><div><h2>Alertas</h2><span>Investigue o sinal e registre a ação tomada no talhão.</span></div></div>{alertsError && <div className="workspace-warning" role="alert"><Icon name="bell" size={17}/>{alertsError}</div>}<div className="alerts-page-grid"><AlertsFeed alerts={alerts} resolved={resolvedAlerts} supported={alertsSupported} fields={fields} busyId={alertActionId} loading={alertsLoading} checkedAt={alertsCheckedAt} onStatusChange={(alert, status) => void setAlertStatus(alert, status)} onRegister={registerAlertOperation}/><AlertRulesPanel rules={alertRules} fields={fields} onSave={saveRule} onToggle={toggleRuleGroup} onDelete={deleteRuleGroup} supported={alertRulesSupported} busy={saving} loading={alertsLoading} createRequest={ruleCreateRequest}/></div></section>}
    </div></main>
    {farmModal && <FarmForm mode={farmModal.mode} farm={farmModal.farm} onClose={() => setFarmModal(null)} onSave={saveFarm} busy={saving}/>}{fieldModal && <FieldForm mode={fieldModal.mode} field={fieldModal.field} farm={farm} onClose={() => setFieldModal(null)} onSave={saveField} busy={saving}/>}{seasonModal && selectedField && <SeasonDialog season={seasonModal.mode === "edit" ? seasonModal.record : undefined} field={selectedField} onClose={() => setSeasonModal(null)} onSave={saveSeason} busy={saving}/>}{operationModal && operationDialogField && <OperationDialog operation={operationModal.mode === "edit" ? operationModal.record : undefined} field={operationDialogField} fields={fields} seasons={seasonTimeline} onClose={() => setOperationModal(null)} onSave={saveOperation} busy={saving} initialType={operationTypePreset}/>}{sensorModal && selectedField && <SensorDialog sensor={sensorModal.mode === "edit" ? sensorModal.record : undefined} field={selectedField} fields={fields} onClose={() => setSensorModal(null)} onSave={saveSensor} busy={saving}/>}
    {accountOpen && <AccountDialog user={user} busy={saving} onClose={() => setAccountOpen(false)} onSave={updateAccount} onDelete={deleteAccount}/>}
    <Toast notice={notice} onDismiss={dismissNotice}/>
  </div>;
}
