"use client";

import dynamic from "next/dynamic";
import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { Alert, AlertRule, apiFetch, detailOf, entityId, Farm, Field, Operation, Reading, Season, Sensor, SeriesPoint, User } from "@/lib/api";
import { OperationDialog, operationTypeLabel, SeasonDialog, seasonStatusLabel, SensorDialog } from "@/components/record-dialogs";
import { AccountDialog, AccountUpdate } from "@/components/account-dialog";
import { ProductionRankingPanel, WeatherPanel } from "@/components/insights-panels";

const FieldMap = dynamic(() => import("@/components/leaflet-map"), { ssr: false, loading: () => <div className="map-frame map-loading"><span className="spinner"/>Carregando mapa…</div> });
const TelemetryChart = dynamic(() => import("@/components/telemetry-chart"), { ssr: false, loading: () => <div className="chart-loading"><span className="spinner"/>Carregando gráfico…</div> });

type Page = "overview" | "farms" | "fields" | "seasons" | "operations" | "sensors" | "alerts";
type FarmModal = { mode: "create" | "edit"; farm?: Farm } | null;
type FieldModal = { mode: "create" | "edit"; field?: Field } | null;
type RecordModal<T> = { mode: "create" } | { mode: "edit"; record: T } | null;
type Notice = { kind: "success" | "error"; text: string };

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
  return new Intl.DateTimeFormat("pt-BR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" }).format(date);
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
  };
  return <svg {...common}>{paths[name] ?? <circle cx="12" cy="12" r="8"/>}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark"><Icon name="leaf" size={21}/></span>{!compact && <span>Agro<span className="brand-light">Pulse</span><small>GESTÃO INTELIGENTE</small></span>}</div>;
}

function AuthScreen({ onAuthenticated, sessionExpired = false }: { onAuthenticated: (token: string, user: User) => void; sessionExpired?: boolean }) {
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
      <div className="auth-brand"><Brand/></div>
      <div className="auth-story-content">
        <span className="eyebrow"><span className="eyebrow-dot"/> TECNOLOGIA NO CAMPO</span>
        <h1>Uma visão mais clara para cada decisão.</h1>
        <p>Conecte suas áreas, acompanhe as condições da lavoura e cuide da sua operação em um só lugar.</p>
        <div className="story-landscape" aria-hidden="true"><div className="sun-disc"/><div className="hill hill-back"/><div className="hill hill-front"/><div className="field-lines"><i/><i/><i/><i/><i/></div></div>
      </div>
      <div className="auth-footer">AgroPulse · Gestão rural inteligente</div>
    </section>
    <section className="auth-form-side">
      <div className="auth-form-wrap">
        <div className="mobile-brand"><Brand/></div>
        <span className="eyebrow muted-eyebrow">SEU ESPAÇO DE GESTÃO</span>
        <h2>{mode === "login" ? "Bem-vindo de volta" : "Comece por aqui"}</h2>
        <p className="auth-subtitle">{mode === "login" ? "Acesse sua conta para acompanhar sua operação." : "Crie seu acesso e organize sua produção."}</p>
        {sessionExpired && mode === "login" && <div className="integration-note" role="status">Sua sessão expirou. Entre novamente para continuar.</div>}
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

function Sidebar({ page, setPage, farms, selectedFarmId, onFarmSelect, user, onLogout, onAccount, mobileOpen, closeMobile }: {
  page: Page; setPage: (page: Page) => void; farms: Farm[]; selectedFarmId: string;
  onFarmSelect: (id: string) => void; user: User; onLogout: () => void; onAccount: () => void; mobileOpen: boolean; closeMobile: () => void;
}) {
  const navItems: { key: Page; label: string; icon: string }[] = [
    { key: "overview", label: "Visão geral", icon: "home" },
    { key: "farms", label: "Fazendas", icon: "farm" },
    { key: "fields", label: "Talhões", icon: "field" },
    { key: "seasons", label: "Safras", icon: "calendar" },
    { key: "operations", label: "Operações", icon: "activity" },
    { key: "sensors", label: "Sensores", icon: "droplet" },
    { key: "alerts", label: "Alertas", icon: "bell" },
  ];
  return <>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Fechar menu" onClick={closeMobile}/>}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand/><button className="icon-button sidebar-close" onClick={closeMobile} aria-label="Fechar menu"><Icon name="close"/></button></div>
      <div className="workspace-label">ESPAÇO DE TRABALHO</div>
      <nav className="main-nav" aria-label="Menu principal">{navItems.map((item) => <button key={item.key} className={`nav-link ${page === item.key ? "nav-active" : ""}`} onClick={() => { setPage(item.key); closeMobile(); }}><Icon name={item.icon}/><span>{item.label}</span>{item.key === "alerts" && <span className="nav-soon">NOVO</span>}</button>)}</nav>
      <div className="sidebar-section"><div className="section-heading">SUAS FAZENDAS <span>{farms.length}</span></div>
        {farms.length === 0 ? <p className="sidebar-empty">Cadastre uma fazenda para começar.</p> : farms.slice(0, 5).map((farm) => <button key={farm.id} onClick={() => { onFarmSelect(farm.id); setPage("overview"); closeMobile(); }} className={`farm-nav ${selectedFarmId === farm.id ? "farm-nav-active" : ""}`}><span className="farm-nav-dot"/><span className="farm-nav-name">{farm.name}</span><small>{farm.state}</small></button>)}
      </div>
      <div className="sidebar-bottom"><button className="profile-trigger" title="Editar minha conta" onClick={onAccount}><div className="profile-avatar">{user.name.trim().charAt(0).toLocaleUpperCase("pt-BR") || "A"}</div><div className="profile-copy"><strong>{user.name}</strong><span>{user.email}</span></div></button><button className="icon-button logout-button" title="Sair" aria-label="Sair" onClick={onLogout}><Icon name="logout"/></button></div>
    </aside>
  </>;
}

function Header({ page, farm, onAdd, onMenu }: { page: Page; farm?: Farm; onAdd: () => void; onMenu: () => void }) {
  const title: Record<Page, string> = { overview: "Visão geral", farms: "Fazendas", fields: "Talhões", seasons: "Safras", operations: "Operações", sensors: "Sensores", alerts: "Alertas" };
  const addLabel = page === "farms" ? "Nova fazenda" : page === "fields" ? "Novo talhão" : page === "seasons" ? "Nova safra" : page === "operations" ? "Nova operação" : page === "sensors" ? "Vincular sensor" : "Adicionar fazenda";
  return <header className="topbar"><div className="topbar-title"><button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={onMenu}><Icon name="menu"/></button><div><p className="breadcrumb">AGROPULSE <span>/</span> {title[page].toLocaleUpperCase("pt-BR")}</p><h1>{page === "overview" && farm ? farm.name : title[page]}</h1></div></div><div className="topbar-actions"><span className="date-chip"><Icon name="calendar" size={16}/>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date())}</span>{page !== "alerts" && <button className="button primary header-add" onClick={onAdd}><Icon name="plus" size={17}/>{addLabel}</button>}</div></header>;
}

function MetricCard({ label, value, unit, icon, tone, caption }: { label: string; value: string; unit?: string; icon: string; tone: string; caption: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon name={icon} size={20}/></div><p className="metric-label">{label}</p><div className="metric-value">{value}<span>{unit}</span></div><p className="metric-caption">{caption}</p></article>;
}

function EmptyState({ title, body, action, onAction, icon = "farm" }: { title: string; body: string; action?: string; onAction?: () => void; icon?: string }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name={icon} size={27}/></span><h3>{title}</h3><p>{body}</p>{action && onAction && <button className="button primary" onClick={onAction}><Icon name="plus" size={16}/>{action}</button>}</div>;
}

function FarmCard({ farm, fieldsCount, area, statsKnown, onSelect, onEdit, onDelete }: { farm: Farm; fieldsCount: number; area: number; statsKnown: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  return <article className="farm-card"><button className="farm-card-main" onClick={onSelect}><div className="farm-card-image"><div className="farm-card-sun"/><div className="farm-card-field-lines"/><span className="farm-card-badge"><Icon name="map" size={14}/>{farm.state}</span></div><div className="farm-card-content"><div className="farm-card-title-row"><h3>{farm.name}</h3><span className="card-more"><Icon name="chevron" size={17}/></span></div><p>{farmPlace(farm)}</p><div className="farm-card-stats">{statsKnown ? <><span><Icon name="field" size={15}/>{fieldsCount} {fieldsCount === 1 ? "talhão" : "talhões"}</span><span><Icon name="map" size={15}/>{formatNumber(area, 1)} ha</span></> : <span><Icon name="field" size={15}/>Abra para ver as áreas cadastradas</span>}</div></div></button><div className="farm-card-actions"><button onClick={onEdit}><Icon name="edit" size={15}/> Editar</button><button className="danger-link" onClick={onDelete}><Icon name="trash" size={15}/> Excluir</button></div></article>;
}

function FieldRow({ field, farm, selected, onSelect, onEdit, onDelete }: { field: Field; farm?: Farm; selected?: boolean; onSelect: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className={`field-row ${selected ? "field-row-selected" : ""}`}><button className="field-row-main" onClick={onSelect}><span className={`crop-symbol crop-${field.crop}`}><Icon name="leaf" size={18}/></span><span className="field-name-block"><strong>{field.name}</strong><small>{farm?.name ?? "Fazenda"} · {crops[field.crop] ?? field.crop}</small></span><span className="field-area">{formatNumber(field.area_ha, 1)} <small>ha</small></span></button><div className="field-actions"><button className="icon-button" title="Editar talhão" aria-label="Editar talhão" onClick={onEdit}><Icon name="edit" size={16}/></button><button className="icon-button danger-icon" title="Excluir talhão" aria-label="Excluir talhão" onClick={onDelete}><Icon name="trash" size={16}/></button></div></div>;
}

function FieldSelector({ fields, selectedId, onChange }: { fields: Field[]; selectedId: string; onChange: (id: string) => void }) {
  return <label className="farm-select-wrap field-select-wrap"><span>Talhão selecionado</span><select value={selectedId} disabled={!fields.length} onChange={(event) => onChange(event.target.value)}>{fields.map((field) => <option key={field.id} value={field.id}>{field.name} · {crops[field.crop]}</option>)}</select><Icon name="down" size={16}/></label>;
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
  return <Modal title={mode === "create" ? "Adicionar talhão" : "Editar talhão"} subtitle={farm ? `${farm.name} · ${farmPlace(farm)}` : "Selecione a fazenda onde fica esta área."} onClose={onClose} wide><form className="modal-form" onSubmit={submit}><div className="form-grid"><label>Nome do talhão<input name="name" defaultValue={field?.name} placeholder="Ex.: Gleba Norte" maxLength={120} required autoFocus/></label><label>Cultura<select name="crop" defaultValue={field?.crop ?? "soja"}>{Object.entries(crops).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><div className="draw-section"><div className="draw-title"><div><strong>Limite da área</strong><p>{field && !points.length ? "O desenho atual aparece no mapa. Clique para redesenhar o limite; sem novos pontos, ele será preservado." : "Toque ou clique no mapa para desenhar o perímetro."}</p></div><button className="text-button" type="button" onClick={() => setPoints([])}>Reiniciar desenho</button></div><FieldMap fields={field && !points.length ? [field] : []} selectedFieldId={field?.id} center={mapCenter} drawPoints={points} onDraw={draw}/><p className="form-hint">Mapa OpenStreetMap centralizado na propriedade. Clique nos limites reais para formar o polígono GeoJSON.</p></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : mode === "create" ? "Cadastrar talhão" : "Salvar alterações"}</button></div></form></Modal>;
}

function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [onClose]);
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Fechar" onClick={onClose}><Icon name="close"/></button></div>{children}</section></div>;
}

const states = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

function AlertRulesPanel({ rules, fields, onCreate, onToggle, onDelete, supported, busy }: { rules: AlertRule[]; fields: Field[]; onCreate: (body: object) => Promise<void>; onToggle: (rule: AlertRule) => void; onDelete: (rule: AlertRule) => void; supported: boolean; busy: boolean }) {
  const [formOpen, setFormOpen] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setError(""); const data = new FormData(event.currentTarget); try { await onCreate({ field_id: String(data.get("field_id")), metric: String(data.get("metric")), operator: String(data.get("operator")), threshold: Number(data.get("threshold")), window_minutes: Number(data.get("window_minutes")), active: true }); setFormOpen(false); } catch (caught) { setError(detailOf(caught)); } };
  return <section className="panel alert-rules-panel"><div className="panel-heading"><div><span className="eyebrow muted-eyebrow">AUTOMAÇÃO</span><h2>Regras de alerta</h2><p>Defina limites para acompanhar condições importantes.</p></div><button className="button secondary compact-button" disabled={!supported || !fields.length} onClick={() => setFormOpen(!formOpen)}><Icon name="plus" size={16}/> Nova regra</button></div>
    {!supported && <div className="integration-note"><Icon name="clock" size={16}/> Regras de alerta estarão disponíveis quando a API for atualizada.</div>}
    {formOpen && <form className="rule-form" onSubmit={submit}><label>Talhão<select name="field_id" required>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label>Métrica<select name="metric">{metrics.map((metric) => <option key={metric.value} value={metric.value}>{metric.label}</option>)}</select></label><label>Condição<select name="operator"><option value="lt">Abaixo de</option><option value="gt">Acima de</option></select></label><label>Limite<input name="threshold" type="number" step="any" defaultValue="30" required/></label><label>Janela (minutos)<input name="window_minutes" type="number" min="1" defaultValue="15" required/></label><div className="rule-form-actions"><button type="button" className="text-button" onClick={() => setFormOpen(false)}>Cancelar</button><button className="button primary compact-button" disabled={busy}>Criar regra</button></div>{error && <div className="inline-error rule-error">{error}</div>}</form>}
    {supported && rules.length === 0 && !formOpen && <div className="panel-empty"><span className="soft-icon"><Icon name="bell"/></span><div><strong>Nenhuma regra configurada</strong><p>Crie uma regra para receber alertas sobre leituras fora do esperado.</p></div></div>}
    {supported && rules.length > 0 && <div className="rules-list">{rules.map((rule) => { const id = entityId(rule); const metric = metrics.find((item) => item.value === rule.metric); const field = fields.find((item) => item.id === rule.field_id); return <div className="rule-row" key={id}><span className="rule-state"><span className={rule.active === false ? "rule-dot paused" : "rule-dot"}/></span><div className="rule-copy"><strong>{metric?.label ?? rule.metric} {rule.operator === "lt" ? "abaixo de" : "acima de"} {formatNumber(rule.threshold ?? 0, 1)} {metric?.unit}</strong><small>{field?.name ?? "Talhão"} · janela de {rule.window_minutes ?? 15} min</small></div><button className={`toggle ${rule.active === false ? "toggle-off" : ""}`} aria-label={rule.active === false ? "Ativar regra" : "Pausar regra"} onClick={() => onToggle(rule)}><span/></button><button className="icon-button danger-icon" aria-label="Excluir regra" onClick={() => onDelete(rule)}><Icon name="trash" size={16}/></button></div>; })}</div>}
  </section>;
}

function SeasonCollection({ field, fields, selectedFieldId, onFieldChange, seasons, loading, error, onAdd, onEdit, onDelete, onAddFarm }: {
  field?: Field; fields: Field[]; selectedFieldId: string; onFieldChange: (id: string) => void; seasons: Season[]; loading: boolean; error: string;
  onAdd: () => void; onEdit: (season: Season) => void; onDelete: (season: Season) => void; onAddFarm: () => void;
}) {
  return <section className="collection-page"><div className="collection-heading"><div><p>PLANEJAMENTO AGRÍCOLA</p><h2>Safras</h2><span>Planeje o ciclo produtivo e compare produtividade prevista e realizada.</span></div><div className="collection-actions"><FieldSelector fields={fields} selectedId={selectedFieldId} onChange={onFieldChange}/><button className="button primary" disabled={!field} onClick={onAdd}><Icon name="plus" size={17}/>Nova safra</button></div></div>{error && <div className="workspace-warning"><Icon name="bell" size={17}/>{error}</div>}{!fields.length ? <EmptyState title="Nenhum talhão disponível" body="Cadastre uma fazenda e um talhão antes de planejar uma safra." action="Cadastrar fazenda" onAction={onAddFarm}/> : loading ? <div className="panel list-loading"><span className="spinner"/>Carregando safras…</div> : seasons.length ? <div className="records-grid">{seasons.map((season) => <article className="record-card" key={season.id}><div className="record-card-top"><span className="record-icon crop-symbol"><Icon name="leaf"/></span><span className={`status-badge season-${season.status}`}>{seasonStatusLabel[season.status]}</span></div><h3>{season.label}</h3><p className="record-subtitle">{field?.name} · {crops[season.crop ?? field?.crop ?? "soja"]}</p><div className="record-facts"><span><small>Plantio</small><strong>{dateLabel(season.planting_date)}</strong></span><span><small>Colheita</small><strong>{dateLabel(season.harvest_date ?? undefined)}</strong></span></div><div className="yield-comparison"><div><span>Esperada</span><strong>{season.expected_yield_kg_ha == null ? "—" : `${formatNumber(season.expected_yield_kg_ha, 0)} kg/ha`}</strong></div><div><span>Realizada</span><strong>{season.yield_kg_ha == null ? "—" : `${formatNumber(season.yield_kg_ha, 0)} kg/ha`}</strong></div></div><div className="record-actions"><button onClick={() => onEdit(season)}><Icon name="edit" size={15}/>Editar</button><button className="danger-link" onClick={() => onDelete(season)}><Icon name="trash" size={15}/>Excluir</button></div></article>)}</div> : <EmptyState title="Nenhuma safra para este talhão" body="Crie uma safra para organizar datas e acompanhar o rendimento esperado." action="Planejar safra" onAction={onAdd}/>}</section>;
}

function OperationCollection({ field, fields, selectedFieldId, onFieldChange, operations, seasons, loading, error, onAdd, onEdit, onDelete, onAddFarm }: {
  field?: Field; fields: Field[]; selectedFieldId: string; onFieldChange: (id: string) => void; operations: Operation[]; seasons: Season[]; loading: boolean; error: string;
  onAdd: () => void; onEdit: (operation: Operation) => void; onDelete: (operation: Operation) => void; onAddFarm: () => void;
}) {
  return <section className="collection-page"><div className="collection-heading"><div><p>DIÁRIO DE CAMPO</p><h2>Operações</h2><span>Registre atividades, custos e observações por talhão.</span></div><div className="collection-actions"><FieldSelector fields={fields} selectedId={selectedFieldId} onChange={onFieldChange}/><button className="button primary" disabled={!field} onClick={onAdd}><Icon name="plus" size={17}/>Nova operação</button></div></div>{error && <div className="workspace-warning"><Icon name="bell" size={17}/>{error}</div>}{!fields.length ? <EmptyState title="Nenhum talhão disponível" body="Cadastre uma fazenda e um talhão antes de registrar operações." action="Cadastrar fazenda" onAction={onAddFarm}/> : loading ? <div className="panel list-loading"><span className="spinner"/>Carregando operações…</div> : operations.length ? <div className="panel operations-timeline">{operations.map((operation) => { const season = seasons.find((item) => item.id === operation.season_id); const note = operation.details?.observacoes; return <article className="operation-row" key={operation.id}><div className="timeline-marker"><span><Icon name="activity" size={17}/></span></div><div className="operation-info"><div className="operation-title"><h3>{operationTypeLabel[operation.type]}</h3><span>{dateLabel(operation.date)}</span></div><p>{season ? `Safra ${season.label}` : field?.name}{operation.cost_brl == null ? "" : ` · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(operation.cost_brl)}`}</p>{typeof note === "string" && note && <small>{note}</small>}</div><div className="record-actions"><button onClick={() => onEdit(operation)} aria-label="Editar operação"><Icon name="edit" size={15}/></button><button className="danger-link" onClick={() => onDelete(operation)} aria-label="Excluir operação"><Icon name="trash" size={15}/></button></div></article>; })}</div> : <EmptyState title="Nenhuma operação registrada" body="Registre plantio, adubação, aplicação, irrigação ou colheita para manter o diário da área atualizado." action="Registrar operação" onAction={onAdd}/>}</section>;
}

function SensorCollection({ field, fields, selectedFieldId, onFieldChange, sensors, loading, error, onAdd, onEdit, onToggle, onDelete, onAddFarm }: {
  field?: Field; fields: Field[]; selectedFieldId: string; onFieldChange: (id: string) => void; sensors: Sensor[]; loading: boolean; error: string;
  onAdd: () => void; onEdit: (sensor: Sensor) => void; onToggle: (sensor: Sensor) => void; onDelete: (sensor: Sensor) => void; onAddFarm: () => void;
}) {
  return <section className="collection-page"><div className="collection-heading"><div><p>TELEMETRIA</p><h2>Sensores</h2><span>Vincule os dispositivos do talhão para habilitar o fluxo de leituras.</span></div><div className="collection-actions"><FieldSelector fields={fields} selectedId={selectedFieldId} onChange={onFieldChange}/><button className="button primary" disabled={!field} onClick={onAdd}><Icon name="plus" size={17}/>Vincular sensor</button></div></div>{error && <div className="workspace-warning"><Icon name="bell" size={17}/>{error}</div>}{!fields.length ? <EmptyState title="Nenhum talhão disponível" body="Cadastre uma fazenda e um talhão antes de vincular sensores." action="Cadastrar fazenda" onAction={onAddFarm}/> : loading ? <div className="panel list-loading"><span className="spinner"/>Carregando sensores…</div> : <><div className="sensor-guidance"><span className="soft-icon"><Icon name="activity"/></span><p>Cadastre o <strong>device_id</strong> que o sensor ou simulador enviará. Leituras associadas ao mesmo identificador serão vinculadas a <strong>{field?.name}</strong>.</p></div>{sensors.length ? <div className="sensor-grid">{sensors.map((sensor) => <article className="sensor-card" key={sensor.id}><span className={`sensor-status ${sensor.active ? "sensor-active" : "sensor-inactive"}`}><i/>{sensor.active ? "Ativo" : "Desativado"}</span><div className="sensor-card-icon"><Icon name="activity" size={22}/></div><h3>{sensor.device_id}</h3><p>{field?.name} · {sensor.active ? "recebendo telemetria" : "leituras pausadas"}</p><div className="sensor-actions"><button className="secondary-action" onClick={() => onToggle(sensor)}>{sensor.active ? "Desativar" : "Ativar"}</button><button className="icon-button" aria-label="Editar sensor" onClick={() => onEdit(sensor)}><Icon name="edit" size={15}/></button><button className="icon-button danger-icon" aria-label="Remover sensor" onClick={() => onDelete(sensor)}><Icon name="trash" size={15}/></button></div></article>)}</div> : <EmptyState title="Nenhum sensor vinculado" body="Vincule o identificador do primeiro dispositivo para começar a receber dados de telemetria." action="Vincular primeiro sensor" onAction={onAdd} icon="activity"/>}</>}</section>;
}

function AlertsFeed({ alerts, supported }: { alerts: Alert[]; supported: boolean }) {
  return <section className="panel alerts-feed"><div className="panel-heading"><div><span className="eyebrow muted-eyebrow">ACOMPANHAMENTO</span><h2>Alertas recentes</h2><p>Eventos abertos nos seus talhões.</p></div><span className="count-pill">{alerts.length}</span></div>{!supported ? <div className="integration-note"><Icon name="clock" size={16}/> O histórico de alertas será exibido quando a API estiver integrada.</div> : alerts.length === 0 ? <div className="panel-empty"><span className="soft-icon"><Icon name="check"/></span><div><strong>Tudo tranquilo por aqui</strong><p>Não há alertas abertos para os talhões selecionados.</p></div></div> : <div className="alerts-list">{alerts.map((alert) => { const metric = metrics.find((item) => item.value === alert.metric); return <article className="alert-item" key={entityId(alert)}><span className={`alert-severity ${alert.status === "resolved" ? "resolved" : ""}`}><Icon name={alert.status === "resolved" ? "check" : "bell"} size={16}/></span><div className="alert-copy"><strong>{alert.title ?? `${metric?.label ?? alert.metric ?? "Leitura"} fora do limite`}</strong><p>{alert.message ?? `Leitura de ${formatNumber(alert.value ?? 0, 1)} ${metric?.unit ?? ""}; limite ${formatNumber(alert.threshold ?? 0, 1)} ${metric?.unit ?? ""}.`}</p><small>{dateLabel(alert.triggered_at ?? alert.created_at, true)}</small></div><span className={`status-badge ${alert.status === "resolved" ? "status-resolved" : "status-open"}`}>{alert.status === "resolved" ? "Resolvido" : "Aberto"}</span></article>; })}</div>}</section>;
}

function Toast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(onDismiss, 4600); return () => window.clearTimeout(timer); }, [notice, onDismiss]);
  if (!notice) return null;
  return <div className={`toast toast-${notice.kind}`} role="status"><Icon name={notice.kind === "success" ? "check" : "bell"} size={17}/><span>{notice.text}</span><button className="icon-button" aria-label="Fechar mensagem" onClick={onDismiss}><Icon name="close" size={16}/></button></div>;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [farms, setFarms] = useState<Farm[]>([]);
  const [farmStats, setFarmStats] = useState<Record<string, { fields: number; area: number }>>({});
  const [selectedFarmId, setSelectedFarmId] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [summary, setSummary] = useState<{ crop: string; fields: number; area_ha: number }[]>([]);
  const [metric, setMetric] = useState<(typeof metrics)[number]["value"]>("soil_moisture");
  const [days, setDays] = useState(7);
  const [farmModal, setFarmModal] = useState<FarmModal>(null);
  const [fieldModal, setFieldModal] = useState<FieldModal>(null);
  const [seasonModal, setSeasonModal] = useState<RecordModal<Season>>(null);
  const [operationModal, setOperationModal] = useState<RecordModal<Operation>>(null);
  const [sensorModal, setSensorModal] = useState<RecordModal<Sensor>>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState("");
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsSupported, setAlertsSupported] = useState(true);
  const [alertsError, setAlertsError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [farmSearch, setFarmSearch] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [farmLoadError, setFarmLoadError] = useState("");
  const [fieldsLoadError, setFieldsLoadError] = useState("");

  const farm = farms.find((item) => item.id === selectedFarmId);
  const selectedField = fields.find((item) => item.id === selectedFieldId);
  const selectedMetric = metrics.find((item) => item.value === metric) ?? metrics[0];
  const fieldArea = fields.reduce((sum, item) => sum + (Number(item.area_ha) || 0), 0);
  const fieldCount = fields.length;
  const latest = readings[0];
  const filteredFarms = farms.filter((item) => `${item.name} ${item.municipality} ${item.state}`.toLocaleLowerCase("pt-BR").includes(farmSearch.toLocaleLowerCase("pt-BR")));
  const filteredFields = fields.filter((item) => `${item.name} ${crops[item.crop] ?? item.crop}`.toLocaleLowerCase("pt-BR").includes(fieldSearch.toLocaleLowerCase("pt-BR")));

  const loadFarms = useCallback(async (auth: string) => {
    const list = (await apiFetch<(Farm & { _id?: string })[]>("/farms", auth)).map(normalizeFarm);
    setFarms(list);
    const stats = await Promise.all(list.map(async (item) => {
      try {
        const rows = await apiFetch<{ fields: number; area_ha: number }[]>(`/analytics/farms/${encodeURIComponent(item.id)}/summary`, auth);
        return [item.id, { fields: rows.reduce((sum, row) => sum + row.fields, 0), area: rows.reduce((sum, row) => sum + row.area_ha, 0) }] as const;
      } catch { return [item.id, null] as const; }
    }));
    setFarmStats(Object.fromEntries(stats.filter((entry): entry is readonly [string, { fields: number; area: number }] => entry[1] !== null)));
    setSelectedFarmId((current) => list.some((item) => item.id === current) ? current : list[0]?.id ?? "");
    return list;
  }, []);

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

  const logout = useCallback(() => {
    window.localStorage.removeItem("agropulse_token");
    setToken(null); setUser(null); setFarms([]); setFields([]); setSeasons([]); setOperations([]); setSensors([]); setSelectedFarmId(""); setSelectedFieldId("");
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
      await apiFetch<void>("/auth/me", token, {
        method: "DELETE",
        body: JSON.stringify({ current_password: currentPassword }),
      });
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
    if (!token || !selectedFarmId) { setFields([]); setSummary([]); setSelectedFieldId(""); setFieldsLoadError(""); return; }
    let active = true; setLoadingWorkspace(true); setFieldsLoadError("");
    Promise.allSettled([
      apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(selectedFarmId)}`, token),
      apiFetch<{ crop: string; fields: number; area_ha: number }[]>(`/analytics/farms/${encodeURIComponent(selectedFarmId)}/summary`, token),
    ]).then(([fieldsResult, summaryResult]) => {
      if (!active) return;
      if (fieldsResult.status === "fulfilled") {
        const list = fieldsResult.value.map(normalizeField); setFields(list);
        setSelectedFieldId((current) => list.some((item) => item.id === current) ? current : list[0]?.id ?? "");
      } else { setFields([]); setSelectedFieldId(""); setFieldsLoadError(detailOf(fieldsResult.reason)); }
      setSummary(summaryResult.status === "fulfilled" ? summaryResult.value : []);
      setLoadingWorkspace(false);
    });
    return () => { active = false; };
  }, [token, selectedFarmId, workspaceVersion]);

  useEffect(() => {
    if (!token || !selectedFieldId) { setSeasons([]); setOperations([]); setSensors([]); setRecordsError(""); setRecordsLoading(false); return; }
    let active = true;
    void loadRecords(token, selectedFieldId, () => active);
    return () => { active = false; };
  }, [token, selectedFieldId, loadRecords]);

  useEffect(() => {
    if (!token || !selectedFieldId) { setSeries([]); setReadings([]); setSeriesError(""); return; }
    let active = true; setSeriesLoading(true); setSeriesError("");
    const query = new URLSearchParams({ metric, unit: days <= 2 ? "hour" : "day", days: String(days) });
    Promise.allSettled([
      apiFetch<SeriesPoint[]>(`/analytics/fields/${encodeURIComponent(selectedFieldId)}/series?${query}`, token),
      apiFetch<Reading[]>(`/fields/${encodeURIComponent(selectedFieldId)}/readings/latest`, token),
    ]).then(([seriesResult, readingResult]) => {
      if (!active) return;
      if (seriesResult.status === "fulfilled") setSeries(seriesResult.value); else { setSeries([]); setSeriesError(detailOf(seriesResult.reason)); }
      if (readingResult.status === "fulfilled") setReadings(readingResult.value); else setReadings([]);
      setSeriesLoading(false);
    });
    return () => { active = false; };
  }, [token, selectedFieldId, metric, days]);

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
    if (!currentFields.length) { setAlerts([]); setAlertRules([]); setAlertsSupported(true); setAlertsError(""); return; }
    setAlertsError("");
    const [rulesResult, alertsResult] = await Promise.allSettled([
      apiFetch<AlertRule[]>("/alert-rules", auth),
      apiFetch<Alert[]>("/alerts?status=open", auth),
    ]);
    const hasUnsupported = [rulesResult, alertsResult].some((result) => result.status === "rejected" && /404|405|não foi possível concluir|not found/i.test(detailOf(result.reason)));
    if (hasUnsupported) setAlertsSupported(false);
    const fieldIds = new Set(currentFields.map((item) => item.id));
    if (rulesResult.status === "fulfilled") setAlertRules(rulesResult.value.map(normalizeAlert).filter((item) => fieldIds.has(item.field_id)));
    else setAlertRules([]);
    if (alertsResult.status === "fulfilled") setAlerts(alertsResult.value.map(normalizeAlert).filter((item) => item.field_id ? fieldIds.has(item.field_id) : true));
    else setAlerts([]);
    if (rulesResult.status === "rejected" && alertsResult.status === "rejected" && !hasUnsupported) setAlertsError(detailOf(rulesResult.reason));
  }, []);

  useEffect(() => { if (token && fields.length) void loadAlerts(token, fields); }, [token, fields, loadAlerts]);

  const signIn = (auth: string, profile: User) => {
    window.localStorage.setItem("agropulse_token", auth); setSessionExpired(false); setToken(auth); setUser(profile); setReady(false);
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
    if (!token || !window.confirm(`Excluir a fazenda “${item.name}” e os talhões vinculados?`)) return;
    try { await apiFetch<void>(`/farms/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); await loadFarms(token); setNotice({ kind: "success", text: "Fazenda excluída." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveField = async (body: object) => {
    if (!token) return;
    setSaving(true);
    try {
      const saved = fieldModal?.mode === "edit" && fieldModal.field ? await apiFetch<Field>(`/fields/${encodeURIComponent(fieldModal.field.id)}`, token, { method: "PATCH", body: JSON.stringify(body) }) : await apiFetch<Field>("/fields", token, { method: "POST", body: JSON.stringify(body) });
      const list = (await apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(selectedFarmId)}`, token)).map(normalizeField); setFields(list); if (saved) setSelectedFieldId(entityId(saved)); setFieldModal(null); setNotice({ kind: "success", text: fieldModal?.mode === "edit" ? "Talhão atualizado com sucesso." : "Talhão cadastrado com sucesso." });
    } finally { setSaving(false); }
  };
  const deleteField = async (item: Field) => {
    if (!token || !window.confirm(`Excluir o talhão “${item.name}”?`)) return;
    try { await apiFetch<void>(`/fields/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); const list = (await apiFetch<(Field & { _id?: string })[]>(`/fields?farm_id=${encodeURIComponent(selectedFarmId)}`, token)).map(normalizeField); setFields(list); setSelectedFieldId(list[0]?.id ?? ""); setNotice({ kind: "success", text: "Talhão excluído." }); }
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
    } finally { setSaving(false); }
  };
  const deleteSeason = async (item: Season) => {
    if (!token || !selectedFieldId || !window.confirm(`Excluir a safra “${item.label}”?`)) return;
    try { await apiFetch<void>(`/seasons/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); await loadRecords(token, selectedFieldId); setNotice({ kind: "success", text: "Safra excluída." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveOperation = async (body: object) => {
    if (!token || !selectedFieldId || !operationModal) return;
    setSaving(true);
    try {
      if (operationModal.mode === "edit") await apiFetch<Operation>(`/operations/${encodeURIComponent(operationModal.record.id)}`, token, { method: "PATCH", body: JSON.stringify(body) });
      else await apiFetch<Operation>("/operations", token, { method: "POST", body: JSON.stringify(body) });
      await loadRecords(token, selectedFieldId); setOperationModal(null); setNotice({ kind: "success", text: operationModal.mode === "edit" ? "Operação atualizada." : "Operação registrada." });
    } finally { setSaving(false); }
  };
  const deleteOperation = async (item: Operation) => {
    if (!token || !selectedFieldId || !window.confirm("Excluir esta operação do histórico?")) return;
    try { await apiFetch<void>(`/operations/${encodeURIComponent(item.id)}`, token, { method: "DELETE" }); await loadRecords(token, selectedFieldId); setNotice({ kind: "success", text: "Operação excluída." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const saveSensor = async (body: object) => {
    if (!token || !selectedFieldId || !sensorModal) return;
    setSaving(true);
    try {
      if (sensorModal.mode === "edit") await apiFetch<Sensor>(`/sensors/${encodeURIComponent(sensorModal.record.id)}`, token, { method: "PATCH", body: JSON.stringify(body) });
      else await apiFetch<Sensor>("/sensors", token, { method: "POST", body: JSON.stringify(body) });
      await loadRecords(token, selectedFieldId); setSensorModal(null); setNotice({ kind: "success", text: sensorModal.mode === "edit" ? "Sensor atualizado." : "Sensor vinculado ao talhão." });
    } finally { setSaving(false); }
  };
  const toggleSensor = async (sensor: Sensor) => {
    if (!token || !selectedFieldId) return;
    try { await apiFetch<Sensor>(`/sensors/${encodeURIComponent(sensor.id)}`, token, { method: "PATCH", body: JSON.stringify({ active: !sensor.active }) }); await loadRecords(token, selectedFieldId); setNotice({ kind: "success", text: sensor.active ? "Sensor desativado." : "Sensor ativado." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const deleteSensor = async (sensor: Sensor) => {
    if (!token || !selectedFieldId || !window.confirm(`Remover o sensor “${sensor.device_id}” deste talhão?`)) return;
    try { await apiFetch<void>(`/sensors/${encodeURIComponent(sensor.id)}`, token, { method: "DELETE" }); await loadRecords(token, selectedFieldId); setNotice({ kind: "success", text: "Sensor removido." }); }
    catch (error) { setNotice({ kind: "error", text: detailOf(error) }); }
  };
  const createRule = async (body: object) => { if (!token) return; setSaving(true); try { await apiFetch<AlertRule>("/alert-rules", token, { method: "POST", body: JSON.stringify(body) }); await loadAlerts(token, fields); setNotice({ kind: "success", text: "Regra de alerta criada." }); } finally { setSaving(false); } };
  const toggleRule = async (rule: AlertRule) => { if (!token) return; try { await apiFetch<AlertRule>(`/alert-rules/${encodeURIComponent(entityId(rule))}`, token, { method: "PATCH", body: JSON.stringify({ active: rule.active === false }) }); await loadAlerts(token, fields); } catch (error) { setNotice({ kind: "error", text: detailOf(error) }); } };
  const deleteRule = async (rule: AlertRule) => { if (!token || !window.confirm("Excluir esta regra de alerta?")) return; try { await apiFetch<void>(`/alert-rules/${encodeURIComponent(entityId(rule))}`, token, { method: "DELETE" }); await loadAlerts(token, fields); setNotice({ kind: "success", text: "Regra removida." }); } catch (error) { setNotice({ kind: "error", text: detailOf(error) }); } };

  if (!ready) return <main className="boot-screen"><Brand/><span className="spinner"/></main>;
  if (!token || !user) return <AuthScreen onAuthenticated={signIn} sessionExpired={sessionExpired}/>;

  const addFarm = () => setFarmModal({ mode: "create" });
  const addField = () => { if (!farm) { setNotice({ kind: "error", text: "Cadastre ou selecione uma fazenda primeiro." }); return; } setFieldModal({ mode: "create" }); };
  const addSeason = () => selectedFieldId ? setSeasonModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de planejar uma safra." });
  const addOperation = () => selectedFieldId ? setOperationModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de registrar uma operação." });
  const addSensor = () => selectedFieldId ? setSensorModal({ mode: "create" }) : setNotice({ kind: "error", text: "Selecione um talhão antes de vincular um sensor." });
  const navAdd = () => page === "fields" ? addField() : page === "seasons" ? addSeason() : page === "operations" ? addOperation() : page === "sensors" ? addSensor() : addFarm();
  const mapCenter: [number, number] | undefined = farm ? [farm.location.coordinates[1], farm.location.coordinates[0]] : undefined;
  const cropBreakdown = summary.length ? summary : Object.entries(fields.reduce<Record<string, { fields: number; area_ha: number }>>((acc, item) => { acc[item.crop] ??= { fields: 0, area_ha: 0 }; acc[item.crop].fields += 1; acc[item.crop].area_ha += item.area_ha; return acc; }, {})).map(([crop, data]) => ({ crop, ...data }));

  return <div className="app-shell"><Sidebar page={page} setPage={setPage} farms={farms} selectedFarmId={selectedFarmId} onFarmSelect={setSelectedFarmId} user={user} onLogout={logout} onAccount={() => setAccountOpen(true)} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)}/><main className="main-area"><Header page={page} farm={farm} onAdd={navAdd} onMenu={() => setMobileOpen(true)}/><div className="page-content">
    {(farmLoadError || fieldsLoadError || workspaceError || recordsError || alertsError) && <div className="workspace-warning" role="alert"><Icon name="bell" size={17}/><span>{farmLoadError || fieldsLoadError || workspaceError || recordsError || alertsError}</span><button className="text-button" onClick={() => { if (farmLoadError) { setFarmLoadError(""); void loadFarms(token); } else if (recordsError && selectedFieldId) { void loadRecords(token, selectedFieldId); } else { setFieldsLoadError(""); setWorkspaceVersion((version) => version + 1); } }}>Tentar novamente</button></div>}
    {page === "overview" && <>
      <section className="welcome-row"><div><p className="welcome-kicker">{new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h2>Bom dia, {user.name.split(" ")[0]} <span className="wave">✳</span></h2><p className="welcome-copy">Acompanhe o que acontece na sua operação hoje.</p></div>{farms.length > 1 && <label className="farm-select-wrap"><span>Fazenda selecionada</span><select value={selectedFarmId} onChange={(event) => setSelectedFarmId(event.target.value)}>{farms.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.state}</option>)}</select><Icon name="down" size={16}/></label>}</section>
      {!farms.length ? farmLoadError ? <EmptyState title="Não foi possível carregar as fazendas" body={farmLoadError} action="Tentar novamente" icon="farm" onAction={() => { setFarmLoadError(""); void loadFarms(token); }}/> : <EmptyState title="Sua operação começa com uma fazenda" body="Cadastre sua primeira propriedade para organizar os talhões e acompanhar as informações da lavoura." action="Cadastrar fazenda" onAction={addFarm}/> : <>
        <section className="metrics-grid"><MetricCard label="Área monitorada" value={formatNumber(fieldArea, 1)} unit="ha" icon="map" tone="green" caption={`${farm?.name ?? "Fazenda selecionada"} · ${farmPlace(farm)}`}/><MetricCard label="Talhões cadastrados" value={String(fieldCount)} icon="field" tone="blue" caption={fieldCount === 1 ? "área produtiva" : "áreas produtivas"}/><MetricCard label="Umidade do solo" value={latest?.soil_moisture == null ? "—" : formatNumber(latest.soil_moisture, 1)} unit={latest?.soil_moisture == null ? "" : "%"} icon="droplet" tone="aqua" caption={latest ? `Atualizado em ${dateLabel(latest.ts, true)}` : "Aguardando leitura dos sensores"}/><MetricCard label="Alertas abertos" value={alertsSupported ? String(alerts.length) : "—"} icon="bell" tone="amber" caption={alertsSupported ? "nas áreas monitoradas" : "integração em andamento"}/></section>
        <div className="dashboard-grid"><section className="panel map-panel"><div className="panel-heading"><div><span className="eyebrow muted-eyebrow">VISÃO ESPACIAL</span><h2>Mapa dos talhões</h2><p>{farmPlace(farm)}</p></div><button className="subtle-action" onClick={() => setPage("fields")}>Ver talhões <Icon name="chevron" size={15}/></button></div><FieldMap fields={fields} selectedFieldId={selectedFieldId} onSelect={setSelectedFieldId} center={mapCenter}/><div className="map-legend"><span><i className="legend-green"/>Talhão cadastrado</span><span>{formatNumber(fieldArea, 1)} ha no total</span></div></section>
          <section className="panel crop-panel"><div className="panel-heading"><div><span className="eyebrow muted-eyebrow">DISTRIBUIÇÃO</span><h2>Áreas por cultura</h2><p>Resumo da fazenda selecionada</p></div><span className="soft-icon"><Icon name="leaf"/></span></div>{cropBreakdown.length ? <div className="crop-list">{cropBreakdown.map((item, index) => { const total = cropBreakdown.reduce((sum, row) => sum + row.area_ha, 0) || 1; const percent = Math.round(item.area_ha / total * 100); return <div className="crop-row" key={item.crop}><div className="crop-row-top"><span><i className={`crop-dot dot-${index % 5}`}/>{crops[item.crop as Field["crop"]] ?? item.crop}</span><strong>{formatNumber(item.area_ha, 1)} <small>ha</small></strong></div><div className="crop-track"><span className={`crop-bar bar-${index % 5}`} style={{ width: `${Math.max(percent, 4)}%` }}/></div><small className="crop-percent">{percent}% da área cadastrada · {item.fields} {item.fields === 1 ? "talhão" : "talhões"}</small></div>; })}</div> : <div className="mini-empty"><Icon name="leaf" size={22}/><span>Cadastre os talhões para ver a distribuição por cultura.</span><button className="text-button" onClick={addField}>Adicionar talhão</button></div>}</section>
        </div>
        <section className="panel chart-panel"><div className="panel-heading chart-heading"><div><span className="eyebrow muted-eyebrow">TELEMETRIA</span><h2>Leituras dos sensores</h2><p>{selectedField ? `${selectedField.name} · ${farm?.name ?? ""}` : "Selecione um talhão para visualizar os dados"}</p></div><div className="chart-controls"><label className="visually-hidden" htmlFor="metric-select">Métrica do gráfico</label><select id="metric-select" value={metric} disabled={!fields.length} onChange={(event) => setMetric(event.target.value as typeof metric)}>{metrics.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><label className="visually-hidden" htmlFor="days-select">Período do gráfico</label><select id="days-select" value={days} disabled={!fields.length} onChange={(event) => setDays(Number(event.target.value))}><option value={1}>Últimas 24 horas</option><option value={2}>Últimos 2 dias</option><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></select></div></div>{seriesLoading ? <div className="chart-loading"><span className="spinner"/>Carregando leituras…</div> : seriesError ? <div className="chart-inline-error"><Icon name="activity" size={18}/><span>{seriesError}</span></div> : <TelemetryChart data={series} unit={selectedMetric.unit} bucketUnit={days <= 2 ? "hour" : "day"}/>}</section>
        <section className="bottom-grid"><div className="panel quick-fields"><div className="panel-heading"><div><span className="eyebrow muted-eyebrow">ÁREAS PRODUTIVAS</span><h2>Talhões da fazenda</h2></div><button className="subtle-action" onClick={() => setPage("fields")}>Ver todos <Icon name="chevron" size={15}/></button></div>{fields.slice(0, 4).map((item) => <FieldRow key={item.id} field={item} farm={farm} selected={item.id === selectedFieldId} onSelect={() => setSelectedFieldId(item.id)} onEdit={() => setFieldModal({ mode: "edit", field: item })} onDelete={() => void deleteField(item)}/>)}{!fields.length && <p className="small-empty">Nenhum talhão cadastrado nesta fazenda.</p>}</div><AlertsFeed alerts={alerts.slice(0, 3)} supported={alertsSupported}/></section>
      </>}
      {selectedField && <div className="insights-grid"><WeatherPanel token={token} fieldId={selectedField.id}/><ProductionRankingPanel token={token} crop={selectedField.crop} state={farm?.state}/></div>}
    </>}
    {page === "farms" && <section className="collection-page"><div className="collection-heading"><div><p>PROPRIEDADES</p><h2>Suas fazendas</h2><span>Gerencie suas propriedades e acompanhe a área produtiva.</span></div><div className="collection-actions"><label className="search-box"><Icon name="search" size={17}/><input aria-label="Buscar fazendas" value={farmSearch} onChange={(event) => setFarmSearch(event.target.value)} placeholder="Buscar fazenda…"/></label><button className="button primary" onClick={addFarm}><Icon name="plus" size={17}/>Nova fazenda</button></div></div>{farmLoadError ? <EmptyState title="Não foi possível carregar as fazendas" body={farmLoadError} action="Tentar novamente" icon="farm" onAction={() => { setFarmLoadError(""); void loadFarms(token); }}/> : filteredFarms.length ? <div className="farm-grid">{filteredFarms.map((item) => { const stats = farmStats[item.id]; const isSelected = item.id === selectedFarmId; const count = stats?.fields ?? (isSelected ? fields.length : 0); const area = stats?.area ?? (isSelected ? fieldArea : 0); return <FarmCard key={item.id} farm={item} fieldsCount={count} area={area} statsKnown={Boolean(stats) || isSelected} onSelect={() => { setSelectedFarmId(item.id); setPage("overview"); }} onEdit={() => setFarmModal({ mode: "edit", farm: item })} onDelete={() => void deleteFarm(item)}/>; })}</div> : <EmptyState title={farms.length ? "Nenhuma fazenda encontrada" : "Cadastre sua primeira fazenda"} body={farms.length ? "Tente buscar por outro nome ou município." : "Adicione uma propriedade para começar a mapear sua operação."} action={farms.length ? undefined : "Cadastrar fazenda"} onAction={farms.length ? undefined : addFarm}/>}</section>}
    {page === "fields" && <section className="collection-page"><div className="collection-heading"><div><p>ÁREAS PRODUTIVAS</p><h2>Talhões</h2><span>Organize suas culturas e acompanhe os limites de cada área.</span></div><div className="collection-actions"><label className="farm-select-wrap collection-farm-select"><span>Fazenda</span><select value={selectedFarmId} disabled={!farms.length} onChange={(event) => setSelectedFarmId(event.target.value)}>{farms.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.state}</option>)}</select><Icon name="down" size={16}/></label><button className="button primary" disabled={!farm} onClick={addField}><Icon name="plus" size={17}/>Novo talhão</button></div></div>{fieldsLoadError ? <EmptyState title="Não foi possível carregar os talhões" body={fieldsLoadError} action="Atualizar" icon="field" onAction={() => { setFieldsLoadError(""); setWorkspaceVersion((version) => version + 1); }}/>: !farms.length ? <EmptyState title="Nenhuma fazenda cadastrada" body="Cadastre uma fazenda antes de adicionar talhões." action="Cadastrar fazenda" onAction={addFarm}/> : <div className="fields-layout"><div className="panel all-fields-panel"><div className="panel-heading"><div><h2>{farm?.name ?? "Talhões"}</h2><p>{fieldCount} áreas · {formatNumber(fieldArea, 1)} hectares</p></div><label className="search-box small-search"><Icon name="search" size={16}/><input aria-label="Buscar talhões" value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="Buscar…"/></label></div>{loadingWorkspace ? <div className="list-loading"><span className="spinner"/>Carregando talhões…</div> : fieldsLoadError ? <div className="panel-empty"><span className="soft-icon"><Icon name="bell"/></span><div><strong>Não foi possível carregar os talhões</strong><p>{fieldsLoadError}</p></div></div> : filteredFields.length ? filteredFields.map((item) => <FieldRow key={item.id} field={item} farm={farm} selected={item.id === selectedFieldId} onSelect={() => setSelectedFieldId(item.id)} onEdit={() => setFieldModal({ mode: "edit", field: item })} onDelete={() => void deleteField(item)}/>) : <div className="small-empty">{fields.length ? "Nenhum talhão corresponde à busca." : "Esta fazenda ainda não possui talhões."}</div>}</div><div className="panel fields-map-panel"><div className="panel-heading"><div><span className="eyebrow muted-eyebrow">OPENSTREETMAP</span><h2>Limites cadastrados</h2><p>{farmPlace(farm)}</p></div></div><FieldMap fields={fields} selectedFieldId={selectedFieldId} onSelect={setSelectedFieldId} center={mapCenter}/><div className="map-legend"><span><i className="legend-green"/>Talhão</span><span>Selecione uma área para ver detalhes</span></div></div></div>}</section>}
    {page === "seasons" && <SeasonCollection field={selectedField} fields={fields} selectedFieldId={selectedFieldId} onFieldChange={setSelectedFieldId} seasons={seasons} loading={recordsLoading} error={recordsError} onAdd={addSeason} onEdit={(record) => setSeasonModal({ mode: "edit", record })} onDelete={(record) => void deleteSeason(record)} onAddFarm={addFarm}/>}
    {page === "operations" && <OperationCollection field={selectedField} fields={fields} selectedFieldId={selectedFieldId} onFieldChange={setSelectedFieldId} operations={operations} seasons={seasons} loading={recordsLoading} error={recordsError} onAdd={addOperation} onEdit={(record) => setOperationModal({ mode: "edit", record })} onDelete={(record) => void deleteOperation(record)} onAddFarm={addFarm}/>}
    {page === "sensors" && <SensorCollection field={selectedField} fields={fields} selectedFieldId={selectedFieldId} onFieldChange={setSelectedFieldId} sensors={sensors} loading={recordsLoading} error={recordsError} onAdd={addSensor} onEdit={(record) => setSensorModal({ mode: "edit", record })} onToggle={(record) => void toggleSensor(record)} onDelete={(record) => void deleteSensor(record)} onAddFarm={addFarm}/>}
    {page === "alerts" && <section className="collection-page"><div className="collection-heading"><div><p>MONITORAMENTO</p><h2>Alertas e regras</h2><span>Acompanhe eventos e defina limites para suas leituras.</span></div><label className="farm-select-wrap"><span>Fazenda selecionada</span><select value={selectedFarmId} disabled={!farms.length} onChange={(event) => setSelectedFarmId(event.target.value)}>{farms.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.state}</option>)}</select><Icon name="down" size={16}/></label></div>{alertsError && <div className="workspace-warning"><Icon name="bell" size={17}/>{alertsError}</div>}<div className="alerts-page-grid"><AlertsFeed alerts={alerts} supported={alertsSupported}/><AlertRulesPanel rules={alertRules} fields={fields} onCreate={createRule} onToggle={(rule) => void toggleRule(rule)} onDelete={(rule) => void deleteRule(rule)} supported={alertsSupported} busy={saving}/></div></section>}
    </div></main>
    {farmModal && <FarmForm mode={farmModal.mode} farm={farmModal.farm} onClose={() => setFarmModal(null)} onSave={saveFarm} busy={saving}/>}{fieldModal && <FieldForm mode={fieldModal.mode} field={fieldModal.field} farm={farm} onClose={() => setFieldModal(null)} onSave={saveField} busy={saving}/>}{seasonModal && selectedField && <SeasonDialog season={seasonModal.mode === "edit" ? seasonModal.record : undefined} field={selectedField} onClose={() => setSeasonModal(null)} onSave={saveSeason} busy={saving}/>}{operationModal && selectedField && <OperationDialog operation={operationModal.mode === "edit" ? operationModal.record : undefined} field={selectedField} seasons={seasons} onClose={() => setOperationModal(null)} onSave={saveOperation} busy={saving}/>}{sensorModal && selectedField && <SensorDialog sensor={sensorModal.mode === "edit" ? sensorModal.record : undefined} field={selectedField} onClose={() => setSensorModal(null)} onSave={saveSensor} busy={saving}/>}
    {accountOpen && <AccountDialog user={user} busy={saving} onClose={() => setAccountOpen(false)} onSave={updateAccount} onDelete={deleteAccount}/>}
    <Toast notice={notice} onDismiss={dismissNotice}/>
  </div>;
}
