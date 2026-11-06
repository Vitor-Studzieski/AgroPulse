"use client";

import dynamic from "next/dynamic";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Field, GeoPoint, Operation, Season, Sensor } from "@/lib/api";
import { useDialogAccessibility } from "@/components/use-dialog-accessibility";
import { pointInField, suggestSensorPosition } from "@/lib/geo";

const SensorPlacementMap = dynamic(() => import("@/components/leaflet-map"), { ssr: false, loading: () => <div className="map-frame map-loading"><span className="skeleton"/>Carregando mapa…</div> });

const seasonStatuses = [
  ["planejada", "Planejada"],
  ["em_andamento", "Em andamento"],
  ["colhida", "Colhida"],
] as const;
const operationTypes = [
  ["plantio", "Plantio"],
  ["adubacao", "Adubação"],
  ["aplicacao", "Aplicação"],
  ["irrigacao", "Irrigação"],
  ["colheita", "Colheita"],
] as const;

function RecordDialog({ title, subtitle, onClose, children, drawer = false }: { title: string; subtitle: string; onClose: () => void; children: ReactNode; drawer?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogAccessibility(dialogRef, onClose);
  return <div className={`modal-scrim ${drawer ? "drawer-scrim" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className={`modal-card ${drawer ? "side-drawer" : ""}`} role="dialog" aria-modal="true" aria-labelledby="record-modal-title"><div className="modal-heading"><div><h2 id="record-modal-title">{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m18 6-12 12M6 6l12 12"/></svg></button></div>{children}</section></div>;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function SeasonDialog({ season, field, onClose, onSave, busy }: { season?: Season; field: Field; onClose: () => void; onSave: (body: object) => Promise<void>; busy: boolean }) {
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    try {
      const harvestDate = String(data.get("harvest_date") ?? "") || null;
      await onSave({
        field_id: field.id,
        label: String(data.get("label")).trim(),
        planting_date: String(data.get("planting_date")),
        harvest_date: harvestDate,
        expected_yield_kg_ha: numberOrNull(data.get("expected_yield_kg_ha")),
        yield_kg_ha: numberOrNull(data.get("yield_kg_ha")),
        status: String(data.get("status")),
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a safra."); }
  };
  return <RecordDialog title={season ? "Editar safra" : "Planejar safra"} subtitle={`${field.name} · ${field.crop}`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-grid"><label className="span-2">Identificação da safra<input name="label" defaultValue={season?.label} placeholder="Ex.: Safra 2026/27" maxLength={32} required autoFocus/></label><label>Plantio<input name="planting_date" type="date" defaultValue={season?.planting_date?.slice(0, 10)} required/></label><label>Colheita prevista<input name="harvest_date" type="date" defaultValue={season?.harvest_date?.slice(0, 10) ?? ""}/></label><label>Produtividade esperada (kg/ha)<input name="expected_yield_kg_ha" type="number" min="0" step="any" defaultValue={season?.expected_yield_kg_ha ?? ""} placeholder="Ex.: 3800"/></label><label>Produtividade realizada (kg/ha)<input name="yield_kg_ha" type="number" min="0" step="any" defaultValue={season?.yield_kg_ha ?? ""} placeholder="Preencher após colheita"/></label><label className="span-2">Status<select name="status" defaultValue={season?.status ?? "planejada"}>{seasonStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : season ? "Salvar alterações" : "Criar safra"}</button></div></form></RecordDialog>;
}

const operationFields: Record<Operation["type"], { name: string; label: string; unit?: string; type?: "text" | "number" }[]> = {
  plantio: [{ name: "cultivar", label: "Cultivar" }, { name: "population_plants_ha", label: "População", unit: "plantas/ha", type: "number" }, { name: "seed_rate_kg_ha", label: "Sementes", unit: "kg/ha", type: "number" }],
  adubacao: [{ name: "fertilizer", label: "Fertilizante" }, { name: "nutrient_formula", label: "Formulação" }, { name: "dose_kg_ha", label: "Dose", unit: "kg/ha", type: "number" }],
  aplicacao: [{ name: "product", label: "Produto" }, { name: "active_ingredient", label: "Ingrediente ativo" }, { name: "dose_l_ha", label: "Dose", unit: "L/ha", type: "number" }, { name: "target", label: "Alvo" }],
  irrigacao: [{ name: "water_depth_mm", label: "Lâmina", unit: "mm", type: "number" }, { name: "duration_hours", label: "Duração", unit: "horas", type: "number" }, { name: "method", label: "Método" }],
  colheita: [{ name: "quantity_kg", label: "Quantidade", unit: "kg", type: "number" }, { name: "moisture_pct", label: "Umidade", unit: "%", type: "number" }, { name: "quality", label: "Classificação" }],
};
const costCategories = [["insumos", "Insumos"], ["mao_de_obra", "Mão de obra"], ["maquinas", "Máquinas"], ["combustivel", "Combustível"], ["outros", "Outros"]] as const;

function localDateTimeValue(value?: string): string {
  if (!value) {
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    return now.toISOString().slice(0, 16);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function OperationDialog({ operation, field, fields, seasons, onClose, onSave, busy, initialType = "plantio" }: { operation?: Operation; field: Field; fields: Field[]; seasons: Season[]; onClose: () => void; onSave: (body: object, files: File[], idempotencyKey?: string) => Promise<void>; busy: boolean; initialType?: Operation["type"] }) {
  const [error, setError] = useState("");
  const createAttempt = useRef<{ payload: string; key: string } | null>(null);
  const [fieldId, setFieldId] = useState(operation?.field_id ?? field.id);
  const [type, setType] = useState<Operation["type"]>(operation?.type ?? initialType);
  const activeField = fields.find((item) => item.id === fieldId) ?? field;
  const availableSeasons = seasons.filter((season) => season.field_id === fieldId);
  const specificData = (operation?.details?.operation_data ?? {}) as Record<string, unknown>;
  const previousCosts = (operation?.details?.cost_breakdown ?? {}) as Record<string, unknown>;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    try {
      const files = data.getAll("attachments").filter((entry): entry is File => entry instanceof File && entry.size > 0);
      const existingAttachmentCount = Array.isArray(operation?.details?.attachments) ? operation.details.attachments.length : 0;
      if (files.length + existingAttachmentCount > 10) throw new Error("Cada operação pode ter até 10 anexos.");
      if (files.some((file) => file.size > 8 * 1024 * 1024)) throw new Error("Cada anexo deve ter no máximo 8 MB.");
      if (files.some((file) => !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type))) throw new Error("Use arquivos PDF, JPEG, PNG ou WebP.");
      const costBreakdown: Record<string, number> = {};
      for (const [key] of costCategories) {
        const value = numberOrNull(data.get(`cost_${key}`));
        if (value !== null) costBreakdown[key] = value;
      }
      const categoryValues = Object.values(costBreakdown);
      const typeData: Record<string, string | number> = {};
      for (const { name, type: fieldType } of operationFields[type]) {
        const rawValue = data.get(`specific_${name}`);
        const value = fieldType === "number" ? numberOrNull(rawValue) : String(rawValue ?? "").trim();
        if (value !== null && value !== "") typeData[name] = value;
      }
      const body = {
        field_id: fieldId,
        season_id: String(data.get("season_id")) || null,
        type,
        date: new Date(String(data.get("date"))).toISOString(),
        source: String(data.get("source")),
        cost_brl: categoryValues.length ? categoryValues.reduce((sum, value) => sum + value, 0) : numberOrNull(data.get("cost_brl")),
        details: {
          ...(operation?.details ?? {}),
          area_ha: numberOrNull(data.get("area_ha")),
          responsavel: String(data.get("responsavel") ?? "").trim(),
          equipamento: String(data.get("equipamento") ?? "").trim(),
          observacoes: String(data.get("observacoes") ?? "").trim(),
          cost_breakdown: costBreakdown,
          operation_data: typeData,
        },
      };
      const payload = JSON.stringify(body);
      if (operation) {
        await onSave(body, files);
      } else {
        const attempt = createAttempt.current;
        const key = attempt?.payload === payload ? attempt.key : globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        createAttempt.current = { payload, key };
        await onSave(body, files, key);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a operação."); }
  };
  return <RecordDialog drawer title={operation ? "Editar operação" : "Registrar operação"} subtitle={`${activeField.name} · registre a atividade e os custos por área.`} onClose={onClose}><form className="modal-form operation-form" onSubmit={submit}>
    <div className={`demo-notice ${operation?.source === "real" ? "demo-notice-real" : ""}`}><strong>{operation ? operation.source === "real" ? "Registro marcado como real" : "Registro de demonstração" : "Novo registro fictício"}</strong><span>{operation ? operation.source === "real" ? "Este registro está marcado como atividade confirmada. Altere a origem apenas se o histórico estiver incorreto." : "Este registro está marcado como fictício e não representa uma atividade real." : "O novo registro começa como fictício. Marque como real somente quando corresponder a uma atividade comprovada."}</span></div>
    <div className="form-grid">
      <label>Talhão<select value={fieldId} onChange={(event) => setFieldId(event.target.value)}>{fields.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.crop}</option>)}</select></label>
      <label>Tipo de operação<select value={type} onChange={(event) => setType(event.target.value as Operation["type"])}>{operationTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Data e hora<input name="date" type="datetime-local" defaultValue={localDateTimeValue(operation?.date)} required/></label>
      <label>Safra relacionada<select name="season_id" defaultValue={operation?.season_id ?? ""}><option value="">Sem safra vinculada</option>{availableSeasons.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}</select></label>
      <label>Origem do registro<select name="source" defaultValue={operation?.source ?? "simulated"}><option value="simulated">Fictício · demonstração</option><option value="real">Real · atividade confirmada</option></select></label>
      <label>Área trabalhada (ha)<input name="area_ha" type="number" min="0" max={activeField.area_ha} step="0.01" defaultValue={String(operation?.details?.area_ha ?? activeField.area_ha)} placeholder={`Até ${activeField.area_ha} ha`}/></label>
    </div>
    <fieldset className="operation-specific-fields"><legend>Detalhes de {operationTypes.find(([value]) => value === type)?.[1].toLocaleLowerCase("pt-BR")}</legend><div className="form-grid">{operationFields[type].map(({ name, label, unit, type: inputType = "text" }) => <label key={name}>{unit ? `${label} (${unit})` : label}<input name={`specific_${name}`} type={inputType} min={inputType === "number" ? 0 : undefined} step={inputType === "number" ? "any" : undefined} defaultValue={String(specificData[name] ?? "")}/></label>)}</div></fieldset>
    <fieldset className="operation-cost-fields"><legend>Custos por categoria (R$)</legend><div className="form-grid">{costCategories.map(([key, label]) => <label key={key}>{label}<input name={`cost_${key}`} type="number" min="0" step="0.01" defaultValue={String(previousCosts[key] ?? "")} placeholder="Opcional"/></label>)}<label>Custo total manual (R$)<input name="cost_brl" type="number" min="0" step="0.01" defaultValue={operation?.cost_brl ?? ""} placeholder="Usado se não detalhar custos"/></label></div><p className="form-hint">Quando houver valores por categoria, a soma deles define o custo total.</p></fieldset>
    <div className="form-grid"><label>Responsável<input name="responsavel" defaultValue={String(operation?.details?.responsavel ?? "")} maxLength={120}/></label><label>Máquina ou equipamento<input name="equipamento" defaultValue={String(operation?.details?.equipamento ?? "")} maxLength={120}/></label><label className="span-2">Observações<textarea name="observacoes" defaultValue={String(operation?.details?.observacoes ?? "")} maxLength={2000} rows={3} placeholder="Contexto adicional da atividade"/></label><label className="span-2">Comprovantes e arquivos<input name="attachments" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple/><small className="form-hint">PDF ou imagem · até 8 MB por arquivo · máximo de 10 anexos</small></label></div>
    {Array.isArray(operation?.details?.attachments) && operation.details.attachments.length > 0 && <p className="form-hint">Os anexos já registrados serão mantidos. Para adicionar novos, selecione arquivos acima.</p>}
    {error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : operation ? "Salvar alterações" : "Registrar operação"}</button></div>
  </form></RecordDialog>;
}

export function SensorDialog({ sensor, field, fields, onClose, onSave, busy }: { sensor?: Sensor; field: Field; fields: Field[]; onClose: () => void; onSave: (body: object) => Promise<void>; busy: boolean }) {
  const [error, setError] = useState("");
  const [fieldId, setFieldId] = useState(sensor?.field_id ?? field.id);
  const [source, setSource] = useState<"simulated" | "real">(sensor?.source ?? "simulated");
  const [location, setLocation] = useState<GeoPoint>(() => sensor?.location ?? { type: "Point", coordinates: suggestSensorPosition(field) });
  const targetField = fields.find((item) => item.id === fieldId) ?? field;
  useEffect(() => {
    if (!sensor) setFieldId(field.id);
  }, [field.id, sensor]);
  useEffect(() => setSource(sensor?.source ?? "simulated"), [sensor]);
  useEffect(() => {
    setLocation(sensor?.field_id === targetField.id && sensor.location?.coordinates
      ? sensor.location
      : { type: "Point", coordinates: suggestSensorPosition(targetField) });
  }, [fieldId, fields, sensor, targetField]);
  const targetFields = useMemo(() => [targetField], [targetField]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    if (!pointInField(location.coordinates, targetField)) { setError("Posicione o sensor dentro do contorno do talhão."); return; }
    try { await onSave({ device_id: String(data.get("device_id")).trim(), field_id: fieldId, location, source, active: sensor?.active ?? true }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível vincular o sensor."); }
  };
  const center = targetField.centroid?.coordinates ? [targetField.centroid.coordinates[1], targetField.centroid.coordinates[0]] as [number, number] : undefined;
  return <RecordDialog title={sensor ? "Editar sensor" : "Vincular sensor"} subtitle="Defina o tipo do dispositivo e marque sua posição no talhão." onClose={onClose}><form className="modal-form sensor-form" onSubmit={submit}><div className="form-grid"><label className="span-2">Identificador do dispositivo<input name="device_id" defaultValue={sensor?.device_id} placeholder="Ex.: sensor-gleba-norte-01" maxLength={120} required autoFocus/></label><label className="span-2">Talhão monitorado<select value={fieldId} onChange={(event) => setFieldId(event.target.value)}>{fields.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.crop}</option>)}</select></label><label className="span-2">Origem das leituras<select name="source" value={source} onChange={(event) => setSource(event.target.value as "simulated" | "real")}><option value="simulated">Simulado · gerado pelo modelo do AgroPulse</option><option value="real">Real · equipamento físico</option></select></label></div><div className="sensor-source-note"><strong>{source === "real" ? "Integração de telemetria pendente" : "Leituras sintéticas de demonstração"}</strong><span>{source === "real" ? "O projeto ainda não oferece uma rota para receber dados do equipamento; este sensor não produzirá leituras até a integração ser implementada." : "O simulador gera clima compartilhado por talhão e ajusta a umidade à chuva e às irrigações registradas como simuladas."}</span></div><section className="sensor-position-section"><div className="draw-title"><div><strong>Posição no mapa</strong><p>Clique dentro do talhão para marcar o ponto de instalação.</p></div><span className="sensor-position-coordinates">{location.coordinates.map((value) => value.toFixed(5)).join(", ")}</span></div><SensorPlacementMap key={fieldId} fields={targetFields} selectedFieldId={targetField.id} center={center} placementPoint={location.coordinates} onPlaceSensor={(point) => setLocation({ type: "Point", coordinates: point })} mini/></section><p className="form-hint">O identificador precisa ser único em todo o sistema.</p>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : sensor ? "Salvar alterações" : "Vincular sensor"}</button></div></form></RecordDialog>;
}

export const seasonStatusLabel: Record<Season["status"], string> = { planejada: "Planejada", em_andamento: "Em andamento", colhida: "Colhida" };
export const operationTypeLabel: Record<Operation["type"], string> = { plantio: "Plantio", adubacao: "Adubação", aplicacao: "Aplicação", irrigacao: "Irrigação", colheita: "Colheita" };
