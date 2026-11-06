"use client";

import { useEffect, useState } from "react";
import { apiFetch, detailOf, Field, IrrigationResponse } from "@/lib/api";

function numberLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(value);
}

function dateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function IrrigationResponsePanel({ field, token }: { field?: Field; token: string }) {
  const [items, setItems] = useState<IrrigationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!field) {
      setItems([]);
      setLoading(false);
      setError("");
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    apiFetch<IrrigationResponse[]>(
      `/analytics/fields/${encodeURIComponent(field.id)}/irrigation-response?window_hours=24&limit=10`,
      token,
    )
      .then((rows) => {
        if (active) setItems(rows.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 10));
      })
      .catch((caught) => { if (active) { setItems([]); setError(detailOf(caught)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [field, token]);

  return <section className="irrigation-response-panel">
    <div className="irrigation-response-heading"><div><h3>Resposta observada após irrigação</h3><p>Compara a média entre sensores com dados nas 24 horas antes e depois do registro.</p></div><span>Leitura temporal · sem inferência de causa</span></div>
    {loading ? <div className="irrigation-response-state">Calculando janelas de leitura…</div>
      : error ? <div className="irrigation-response-state response-error" role="alert">{error}</div>
      : items.length ? <div className="irrigation-response-list">{items.map((response) => {
        const delta = response.delta_percentage_points;
        const hasBefore = response.before.avg_soil_moisture != null;
        const hasAfter = response.after.avg_soil_moisture != null;
        return <article className="irrigation-response-card" key={response.operation_id}>
          <header><div><strong>{field?.name}</strong><time>{dateLabel(response.date)}</time></div><div className="irrigation-response-sources"><span className={`operation-source source-${response.source}`}>{response.source === "real" ? "Operação real" : "Operação fictícia"}</span><span className="telemetry-source">Telemetria simulada</span></div></header>
          <div className="irrigation-response-measures">
            <div><span>24h antes</span><strong>{numberLabel(response.before.avg_soil_moisture)}<small>%</small></strong><small>{response.before.sensors} sensores · {response.before.readings} leituras</small></div>
            <div className="response-arrow" aria-hidden="true">→</div>
            <div><span>24h depois</span><strong>{numberLabel(response.after.avg_soil_moisture)}<small>%</small></strong><small>{response.after.sensors} sensores · {response.after.readings} leituras</small></div>
          </div>
          <footer>
            <span>{response.water_depth_mm == null ? "Lâmina não informada" : `${numberLabel(response.water_depth_mm)} mm`}{response.method ? ` · ${response.method}` : ""}</span>
            <strong className={delta == null ? "" : delta >= 0 ? "response-positive" : "response-negative"}>{delta == null ? (hasBefore || hasAfter ? "Amostra incompleta" : "Sem leituras nas janelas") : `${delta > 0 ? "+" : ""}${numberLabel(delta)} p.p.`}</strong>
          </footer>
          {!hasBefore || !hasAfter ? <small className="response-sample-note">A comparação precisa de leituras nas duas janelas.</small> : null}
        </article>;
      })}</div>
      : <div className="irrigation-response-state">Registre uma operação de irrigação para comparar as leituras do talhão antes e depois.</div>}
  </section>;
}
