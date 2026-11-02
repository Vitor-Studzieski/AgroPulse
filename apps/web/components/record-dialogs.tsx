"use client";

import { FormEvent, ReactNode, useRef, useState } from "react";
import { Field, Operation, Season, Sensor } from "@/lib/api";
import { useDialogFocus } from "@/components/use-dialog-focus";

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

function RecordDialog({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement | null>(null);
  useDialogFocus(dialogRef, onClose);
  return <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="record-modal-title"><div className="modal-heading"><div><h2 id="record-modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Fechar" onClick={onClose}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m18 6-12 12M6 6l12 12"/></svg></button></div>{children}</section></div>;
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

export function OperationDialog({ operation, field, seasons, onClose, onSave, busy, initialType = "plantio" }: { operation?: Operation; field: Field; seasons: Season[]; onClose: () => void; onSave: (body: object, idempotencyKey?: string) => Promise<void>; busy: boolean; initialType?: Operation["type"] }) {
  const [error, setError] = useState("");
  const createAttempt = useRef<{ payload: string; key: string } | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    try {
      const body = {
        field_id: field.id,
        season_id: String(data.get("season_id")) || null,
        type: String(data.get("type")),
        date: String(data.get("date")),
        cost_brl: numberOrNull(data.get("cost_brl")),
        details: { observacoes: String(data.get("details")).trim() },
      };
      if (operation) {
        await onSave(body);
      } else {
        const payload = JSON.stringify(body);
        const attempt = createAttempt.current;
        const key = attempt?.payload === payload ? attempt.key : globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        createAttempt.current = { payload, key };
        await onSave(body, key);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a operação."); }
  };
  return <RecordDialog title={operation ? "Editar operação" : "Registrar operação"} subtitle={`${field.name} · acompanhe as atividades desta área.`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-grid"><label>Tipo de operação<select name="type" defaultValue={operation?.type ?? initialType}>{operationTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Data<input name="date" type="date" defaultValue={operation?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)} required/></label><label>Safra relacionada<select name="season_id" defaultValue={operation?.season_id ?? ""}>{(!operation?.season_id) && <option value="">Sem safra vinculada</option>}{seasons.map((season) => <option key={season.id} value={season.id}>{season.label}</option>)}</select></label><label>Custo (R$)<input name="cost_brl" type="number" min="0" step="0.01" defaultValue={operation?.cost_brl ?? ""} placeholder="Opcional"/></label><label className="span-2">Observações<textarea name="details" defaultValue={String(operation?.details?.observacoes ?? "")} maxLength={2000} rows={3} placeholder="Produtos utilizados, quantidade, equipe ou outras observações"/></label></div>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : operation ? "Salvar alterações" : "Registrar operação"}</button></div></form></RecordDialog>;
}

export function SensorDialog({ sensor, field, onClose, onSave, busy }: { sensor?: Sensor; field: Field; onClose: () => void; onSave: (body: object) => Promise<void>; busy: boolean }) {
  const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); const data = new FormData(event.currentTarget);
    try { await onSave({ device_id: String(data.get("device_id")).trim(), field_id: field.id, active: sensor?.active ?? true }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível vincular o sensor."); }
  };
  return <RecordDialog title={sensor ? "Editar sensor" : "Vincular sensor"} subtitle={`${field.name} · use o mesmo identificador configurado no dispositivo ou simulador.`} onClose={onClose}><form className="modal-form" onSubmit={submit}><div className="form-grid"><label className="span-2">Identificador do dispositivo<input name="device_id" defaultValue={sensor?.device_id} placeholder="Ex.: sensor-gleba-norte-01" maxLength={120} required autoFocus/></label></div><p className="form-hint">O identificador deve ser único na sua conta e coincidir com o device_id usado pelo emissor de telemetria.</p>{error && <div className="inline-error" role="alert">{error}</div>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancelar</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Salvando…" : sensor ? "Salvar alterações" : "Vincular sensor"}</button></div></form></RecordDialog>;
}

export const seasonStatusLabel: Record<Season["status"], string> = { planejada: "Planejada", em_andamento: "Em andamento", colhida: "Colhida" };
export const operationTypeLabel: Record<Operation["type"], string> = { plantio: "Plantio", adubacao: "Adubação", aplicacao: "Aplicação", irrigacao: "Irrigação", colheita: "Colheita" };
