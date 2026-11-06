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
  const [days, setDays] = useState(30);
  const [retry, setRetry] = useState(0);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  useEffect(() => {
    setDays(30);
    setSelectedYear(null);
    setHistory(null);
  }, [fieldId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = selectedYear === null ? new URLSearchParams({ days: "30" }) : new URLSearchParams({ year: String(selectedYear) });
    apiFetch<WeatherHistory>(`/analytics/fields/${encodeURIComponent(fieldId)}/weather?${query}`, token)
      .then((result) => {
        if (!active) return;
        setHistory(result);
        if (selectedYear === null && result.readings.length === 0 && result.available_years.length) setSelectedYear(result.available_years[0]);
      })
      .catch((caught) => { if (active) setError(detailOf(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fieldId, token, selectedYear, retry]);

  const cutoff = Date.now() - days * 86_400_000;
  const visibleReadings = selectedYear === null
    ? history?.readings.filter((item) => new Date(item.ts).getTime() >= cutoff) ?? []
    : history?.readings ?? [];
  const latest = visibleReadings.at(-1) ?? history?.readings.at(-1);
  const stale = latest ? Date.now() - new Date(latest.ts).getTime() > 86_400_000 : false;
  const bars = visibleReadings.slice(-24);
  const maxTemp = Math.max(...bars.map((item) => item.air_temp ?? 0), 1);
  return (
    <section className="panel insight-panel">
      <div className="panel-heading">
        <div><span className="eyebrow muted-eyebrow">CLIMA LOCAL</span><h2>Estação meteorológica</h2><p>Dados horários da estação do INMET mais próxima.</p></div>
      </div>
      {loading ? <div className="insight-state"><span className="skeleton"/>Carregando histórico climático…</div> : error ? <div className="insight-state insight-error" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div> : !history?.station ? <div className="insight-state">Nenhuma estação encontrada em até 100 km do talhão.</div> : <>
        <div className="weather-heading-row">
          <div className="station-summary"><strong>{history.station.name ?? history.station.code} · INMET {history.station.code} · {numberLabel(history.station.distance_km)} km</strong></div>
          <div className="weather-controls">
            {history.available_years.length > 0 && <label className="weather-year-control">Histórico<select aria-label="Ano do histórico climático" value={selectedYear ?? "recent"} onChange={(event) => setSelectedYear(event.target.value === "recent" ? null : Number(event.target.value))}><option value="recent">Últimos 30 dias</option>{history.available_years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>}
            {selectedYear === null && <div className="segmented-control weather-period-tabs" role="group" aria-label="Período climático">{[{ days: 1, label: "Hoje" }, { days: 7, label: "7 dias" }, { days: 30, label: "30 dias" }].map((item) => <button key={item.days} type="button" aria-pressed={days === item.days} className={days === item.days ? "active" : ""} onClick={() => setDays(item.days)}>{item.label}</button>)}</div>}
          </div>
        </div>
        {selectedYear !== null && <p className="weather-year-note">Observações importadas do ano-base {selectedYear}.</p>}
        {stale && latest && <span className="weather-stale-tag">Dados desatualizados · última leitura em {new Intl.DateTimeFormat("pt-BR").format(new Date(latest.ts))}</span>}
        {latest ? <>
          <div className="weather-metrics">
            <div><span>Temperatura</span><strong>{numberLabel(latest.air_temp)} <small>°C</small></strong></div>
            <div><span>Chuva na hora</span><strong>{numberLabel(latest.rain_mm)} <small>mm</small></strong></div>
            <div><span>Umidade</span><strong>{numberLabel(latest.humidity, 0)} <small>%</small></strong></div>
            <div><span>Vento</span><strong>{numberLabel(latest.wind_ms)} <small>m/s</small></strong></div>
          </div>
          <p className="insight-updated">Última observação: {timeLabel(latest.ts)}</p>
          <div className="weather-history" aria-label="Últimas observações meteorológicas">
            {bars.map((reading) => <div className="weather-history-row" key={reading.ts} title={`${timeLabel(reading.ts)} · ${numberLabel(reading.air_temp)} °C`}><span style={{ height: `${Math.max((reading.air_temp ?? 0) / maxTemp * 58, 4)}px` }}/><time>{new Intl.DateTimeFormat("pt-BR", { hour: "2-digit" }).format(new Date(reading.ts))}</time></div>)}
          </div>
        </> : <div className="insight-state">A estação foi localizada, mas ainda não há observações importadas no período.</div>}
      </>}
    </section>
  );
}

export function ProductionRankingPanel({ token, crop: fieldCrop, state, municipality }: { token: string; crop: string; state?: string; municipality?: string }) {
  const [crop, setCrop] = useState<SupportedCrop>(supportedCrops.includes(fieldCrop as SupportedCrop) ? fieldCrop as SupportedCrop : "soja");
  const [rows, setRows] = useState<ProductionRankingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const rankingRows = [...rows].sort((left, right) => right.yield_kg_ha - left.yield_kg_ha);
  const topRows = rankingRows.slice(0, 5);
  const normalizeMunicipality = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  const municipalityRow = municipality ? rankingRows.find((row) => normalizeMunicipality(row.municipality) === normalizeMunicipality(municipality)) : undefined;
  const displayedRows = municipalityRow && !topRows.some((row) => row.municipality === municipalityRow.municipality && row.state === municipalityRow.state) ? [...topRows, municipalityRow] : topRows;
  const maxYield = Math.max(...displayedRows.map((row) => row.yield_kg_ha), 1);

  useEffect(() => {
    setCrop(supportedCrops.includes(fieldCrop as SupportedCrop) ? fieldCrop as SupportedCrop : "soja");
  }, [fieldCrop]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ crop, limit: "100" });
    if (state) query.set("state", state);
    apiFetch<ProductionRankingRow[]>(`/analytics/production/ranking?${query}`, token)
      .then((result) => { if (active) setRows(result); })
      .catch((caught) => { if (active) setError(detailOf(caught)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [crop, state, token, retry]);

  return (
    <section className="panel insight-panel">
      <div className="panel-heading ranking-heading">
        <div><h2>Produtividade municipal</h2><p>Comparação com registros agrícolas oficiais do IBGE.</p></div>
      </div>
      <div className="ranking-crop-tabs" role="tablist" aria-label="Cultura do ranking">{supportedCrops.map((item) => <button key={item} type="button" role="tab" aria-selected={crop === item} className={`crop-${item} ${crop === item ? "active" : ""}`} onClick={() => setCrop(item)}>{cropLabels[item]}</button>)}</div>
      {loading ? <div className="insight-state"><span className="skeleton"/>Carregando ranking…</div> : error ? <div className="insight-state insight-error" role="alert"><span>{error}</span><button type="button" className="text-button" onClick={() => setRetry((value) => value + 1)}>Tentar novamente</button></div> : rows.length === 0 ? <div className="insight-state">Ainda não há dados importados para {cropLabels[crop]}{state ? ` em ${state}` : ""}.</div> : <>
        <div className="ranking-meta">{cropLabels[crop]} · {state ?? "Brasil"} · ano-base {rows[0].year}</div>
        <div className="ranking-list">{displayedRows.map((row) => { const ownRegion = municipalityRow?.municipality === row.municipality && municipalityRow.state === row.state; const position = rankingRows.findIndex((candidate) => candidate.municipality === row.municipality && candidate.state === row.state) + 1; return <div className={`ranking-row ${ownRegion ? "ranking-own-region" : ""}`} key={`${row.state}-${row.municipality}`}><div className="ranking-row-top"><strong><span>{position}.</span> {row.municipality}{ownRegion && <small>Sua região</small>}</strong><b>{numberLabel(row.yield_kg_ha, 0)} <small>kg/ha</small></b></div><div className="ranking-bar-track"><i style={{ width: `${Math.max(row.yield_kg_ha / maxYield * 100, 1)}%` }} className={`rank-bar crop-${crop}`}/></div></div>; })}</div>
      </>}
    </section>
  );
}
