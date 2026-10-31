"use client";

import { useEffect, useState } from "react";
import { apiFetch, detailOf, ProductionRankingRow, WeatherHistory } from "@/lib/api";

const supportedCrops = ["soja", "milho", "cana"] as const;
type SupportedCrop = (typeof supportedCrops)[number];
const cropLabels: Record<SupportedCrop, string> = {
  soja: "Soja",
  milho: "Milho",
  cana: "Cana-de-açúcar",
};

function numberLabel(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function WeatherPanel({ token, fieldId }: { token: string; fieldId: string }) {
  const [history, setHistory] = useState<WeatherHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    setSelectedYear(null);
  }, [fieldId]);

  useEffect(() => {
    let active = true;
    let fallingBackToYear = false;
    setLoading(true);
    setError("");
    const period = selectedYear === null ? "days=7" : `year=${selectedYear}`;
    apiFetch<WeatherHistory>(`/analytics/fields/${encodeURIComponent(fieldId)}/weather?${period}`, token)
      .then((result) => {
        if (!active) return;
        const mostRecentYear = result.available_years[0];
        if (selectedYear === null && result.readings.length === 0 && mostRecentYear !== undefined) {
          fallingBackToYear = true;
          setSelectedYear(mostRecentYear);
          return;
        }
        setHistory(result);
      })
      .catch((caught) => { if (active) setError(detailOf(caught)); })
      .finally(() => { if (active && !fallingBackToYear) setLoading(false); });
    return () => { active = false; };
  }, [fieldId, token, selectedYear]);

  const latest = history?.readings.at(-1);
  return (
    <section className="panel insight-panel">
      <div className="panel-heading">
        <div><span className="eyebrow muted-eyebrow">CLIMA LOCAL</span><h2>Estação meteorológica</h2><p>Dados horários da estação do INMET mais próxima.</p></div>
      </div>
      {loading ? <div className="insight-state"><span className="spinner"/>Carregando histórico climático…</div> : error ? <div className="insight-state insight-error" role="alert">{error}</div> : !history?.station ? <div className="insight-state">Nenhuma estação encontrada em até 100 km do talhão.</div> : <>
        <div className="weather-heading-row">
          <div className="station-summary"><strong>{history.station.name ?? history.station.code}</strong><span>{history.station.state ?? ""} · {numberLabel(history.station.distance_km)} km · INMET {history.station.code}</span></div>
          <label className="weather-period-select"><span>Período</span><select aria-label="Período climático" value={selectedYear === null ? "recent" : String(selectedYear)} onChange={(event) => setSelectedYear(event.target.value === "recent" ? null : Number(event.target.value))}><option value="recent">Últimos 7 dias</option>{history.available_years.map((year) => <option key={year} value={year}>Ano {year}</option>)}</select></label>
        </div>
        {latest ? <>
          <div className="weather-metrics">
            <div><span>Temperatura</span><strong>{numberLabel(latest.air_temp)} <small>°C</small></strong></div>
            <div><span>Chuva na hora</span><strong>{numberLabel(latest.rain_mm)} <small>mm</small></strong></div>
            <div><span>Umidade</span><strong>{numberLabel(latest.humidity, 0)} <small>%</small></strong></div>
            <div><span>Vento</span><strong>{numberLabel(latest.wind_ms)} <small>m/s</small></strong></div>
          </div>
          <p className="insight-updated">Última observação: {timeLabel(latest.ts)}</p>
          <div className="weather-history" aria-label="Últimas observações meteorológicas">
            {history.readings.slice(-5).reverse().map((reading) => <div className="weather-history-row" key={reading.ts}><time>{timeLabel(reading.ts)}</time><span>{numberLabel(reading.air_temp)} °C</span><span>{numberLabel(reading.rain_mm)} mm</span><span>{numberLabel(reading.humidity, 0)}%</span></div>)}
          </div>
        </> : <div className="insight-state">A estação foi localizada, mas ainda não há observações importadas no período.</div>}
      </>}
    </section>
  );
}

export function ProductionRankingPanel({ token, crop: fieldCrop, state }: { token: string; crop: string; state?: string }) {
  const [crop, setCrop] = useState<SupportedCrop>(supportedCrops.includes(fieldCrop as SupportedCrop) ? fieldCrop as SupportedCrop : "soja");
  const [rows, setRows] = useState<ProductionRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setCrop(supportedCrops.includes(fieldCrop as SupportedCrop) ? fieldCrop as SupportedCrop : "soja");
  }, [fieldCrop]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ crop });
    if (state) query.set("state", state);
    apiFetch<ProductionRankingRow[]>(`/analytics/production/ranking?${query}`, token)
      .then((result) => { if (active) setRows(result); })
      .catch((caught) => { if (active) setError(detailOf(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [crop, state, token]);

  return (
    <section className="panel insight-panel">
      <div className="panel-heading ranking-heading">
        <div><span className="eyebrow muted-eyebrow">REFERÊNCIA REGIONAL</span><h2>Produtividade municipal</h2><p>Comparação com registros agrícolas oficiais do IBGE.</p></div>
        <label className="ranking-crop-select"><span className="visually-hidden">Cultura do ranking</span><select value={crop} onChange={(event) => setCrop(event.target.value as SupportedCrop)}>{supportedCrops.map((item) => <option key={item} value={item}>{cropLabels[item]}</option>)}</select></label>
      </div>
      {loading ? <div className="insight-state"><span className="spinner"/>Carregando ranking…</div> : error ? <div className="insight-state insight-error" role="alert">{error}</div> : rows.length === 0 ? <div className="insight-state">Ainda não há dados importados para {cropLabels[crop]}{state ? ` em ${state}` : ""}.</div> : <>
        <div className="ranking-meta">{cropLabels[crop]} · {state ?? "Brasil"} · ano-base {rows[0].year}</div>
        <div className="ranking-table-wrap"><table className="ranking-table"><thead><tr><th>Município</th><th>Produtividade</th><th>Produção</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.state}-${row.municipality}`}><td><strong>{row.municipality}</strong><small>{row.state}</small></td><td>{numberLabel(row.yield_kg_ha, 0)} <small>kg/ha</small></td><td>{numberLabel(row.production_t, 0)} <small>t</small></td></tr>)}</tbody></table></div>
      </>}
    </section>
  );
}
