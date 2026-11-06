"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Alert, AlertRule, Field, Reading, Sensor, SeriesPoint } from "@/lib/api";
import { IrrigationResponsePanel } from "@/components/irrigation-response";
import { ProductionRankingPanel, WeatherPanel } from "@/components/insights-panels";

const cropLabels: Record<Field["crop"], string> = {
  soja: "Soja",
  milho: "Milho",
  cana: "Cana-de-açúcar",
  cafe: "Café",
  trigo: "Trigo",
  algodao: "Algodão",
};

type Metric = "soil_moisture" | "soil_temp" | "air_temp" | "rainfall_mm";

function number(value: number, fraction = 1) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: fraction, maximumFractionDigits: fraction }).format(value);
}

function ageLabel(value?: string) {
  if (!value) return "sem leitura recente";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  return minutes < 1 ? "agora" : minutes < 60 ? `há ${minutes} min` : `há ${Math.floor(minutes / 60)} h`;
}

function shortName(value: string) {
  return value.replace(/^Talhão\s*/i, "Área ");
}

type Props = {
  fields: Field[];
  selectedField?: Field;
  selectedFieldId: string;
  onSelectField: (id: string) => void;
  onLogIrrigation: () => void;
  onSetup: () => void;
  setupLabel: string;
  sensors: Sensor[];
  readings: Reading[];
  alerts: Alert[];
  alertRules: AlertRule[];
  loading: boolean;
  error: string;
  metric: Metric;
  days: number;
  series: SeriesPoint[];
  seriesLoading: boolean;
  seriesError: string;
  chart: ReactNode;
  onMetricChange: (metric: Metric) => void;
  onDaysChange: (days: number) => void;
  token: string;
  farmName: string;
  municipality?: string;
  state?: string;
};

export function FieldIntelligence({
  fields, selectedField, selectedFieldId, onSelectField, onLogIrrigation, onSetup, setupLabel, sensors, readings, alerts,
  alertRules, loading, error, metric, days, series, seriesLoading, seriesError, chart,
  onMetricChange, onDaysChange, token, farmName, municipality, state,
}: Props) {
  const [cropFilter, setCropFilter] = useState("all");
  const visibleFields = useMemo(() => fields.filter((field) => cropFilter === "all" || field.crop === cropFilter), [fields, cropFilter]);
  const latestReadingBySensor = useMemo(() => {
    const latest = new Map<string, Reading>();
    for (const reading of readings) {
      const previous = latest.get(reading.sensor_id);
      if (!previous || Date.parse(reading.ts) > Date.parse(previous.ts)) latest.set(reading.sensor_id, reading);
    }
    return latest;
  }, [readings]);
  const activeSensorIds = new Set(sensors.filter((sensor) => sensor.active).map((sensor) => sensor.id));
  const currentReadings = readings.filter((reading) => activeSensorIds.has(reading.sensor_id));
  const fieldMeans = fields.map((field) => {
    const ids = new Set(sensors.filter((sensor) => sensor.field_id === field.id && sensor.active).map((sensor) => sensor.id));
    const measurements = readings.filter((reading) => ids.has(reading.sensor_id) && typeof reading.soil_moisture === "number");
    return measurements.length ? measurements.reduce((sum, reading) => sum + (reading.soil_moisture ?? 0), 0) / measurements.length : null;
  }).filter((value): value is number => value !== null);
  const averageMoisture = fieldMeans.length ? fieldMeans.reduce((sum, value) => sum + value, 0) / fieldMeans.length : null;
  const activeSensors = sensors.filter((sensor) => sensor.active);
  const freshSensors = activeSensors.filter((sensor) => {
    const latest = latestReadingBySensor.get(sensor.id);
    return latest && Date.now() - Date.parse(latest.ts) <= 60 * 60_000;
  }).length;
  const cropOptions = [...new Set(fields.map((field) => field.crop))];
  const metrics: { value: Metric; label: string; unit: string }[] = [
    { value: "soil_moisture", label: "Umidade do solo", unit: "%" },
    { value: "soil_temp", label: "Temp. do solo", unit: "°C" },
    { value: "air_temp", label: "Temp. do ar", unit: "°C" },
    { value: "rainfall_mm", label: "Chuva", unit: "mm" },
  ];
  const selectedFieldRule = alertRules.some((rule) => rule.field_id === selectedFieldId && rule.active && rule.metric === "soil_moisture");

  return <section className="collection-page intelligence-page">
    <header className="intelligence-heading">
      <div><span className="intelligence-kicker">LEITURAS CONECTADAS · VISÃO DE CAMPO</span><h2>Inteligência da lavoura</h2><p>Compare sinais dos sensores, eventos e registros de irrigação por talhão.</p></div>
      <button className="button primary" type="button" onClick={onLogIrrigation}><span aria-hidden="true">＋</span>Registrar irrigação</button>
    </header>

    <section className="intelligence-hero" aria-label="Resumo da propriedade">
      <div className="intelligence-hero-copy"><span className="hero-live"><i/> MONITORAMENTO ATIVO</span><h3>{farmName || "Sua fazenda"}<br/><span>{municipality ? `${municipality}, ${state}` : "Dados organizados por talhão"}</span></h3><p>Os dados mostram o que foi medido e registrado. Use o contexto antes de decidir o próximo manejo.</p></div>
      <div className="hero-signal-card"><span>Umidade média registrada</span><strong>{averageMoisture === null ? "—" : number(averageMoisture)}<small>{averageMoisture === null ? "" : "%"}</small></strong><div className="hero-signal-track"><i style={{ width: `${Math.max(0, Math.min(averageMoisture ?? 0, 100))}%` }}/></div><small>{fieldMeans.length} {fieldMeans.length === 1 ? "talhão com leitura" : "talhões com leitura"}</small></div>
      <div className="hero-photo-credit">AgroPulse · contexto visual da demonstração</div>
    </section>

    <div className="intelligence-kpis">
      <article><span>Talhões na visão</span><strong>{fields.length}</strong><small>Da fazenda selecionada</small></article>
      <article><span>Sensores ativos</span><strong>{activeSensors.length}</strong><small>{freshSensors} com leitura na última hora</small></article>
      <article><span>Alertas abertos</span><strong className={alerts.length ? "kpi-attention" : ""}>{alerts.length}</strong><small>{selectedFieldRule ? "Regra ativa no talhão selecionado" : "Sem regra de umidade neste talhão"}</small></article>
      <article><span>Leituras disponíveis</span><strong>{currentReadings.length}</strong><small>Última leitura por sensor ativo</small></article>
    </div>

    <section className="field-monitoring panel">
      <div className="panel-heading"><div><span className="muted-eyebrow">COMPARAÇÃO DE CAMPO</span><h2>Umidade e sinal por talhão</h2><p>Selecione uma área para ver sua série e o histórico de manejo.</p></div><div className="field-filter-chips" role="group" aria-label="Filtrar talhões por cultura"><button type="button" className={cropFilter === "all" ? "active" : ""} onClick={() => setCropFilter("all")}>Todas</button>{cropOptions.map((crop) => <button type="button" key={crop} className={cropFilter === crop ? "active" : ""} onClick={() => setCropFilter(crop)}>{cropLabels[crop]}</button>)}</div></div>
      {error ? <div className="intelligence-state error" role="alert">{error}</div> : loading ? <div className="intelligence-state"><span className="skeleton"/> Carregando sinais dos talhões…</div> : !fields.length ? <div className="intelligence-empty"><span aria-hidden="true">✳</span><h3>Comece conectando sua área</h3><p>Cadastre uma fazenda e um talhão para comparar leituras, alertas e manejos.</p><button className="button primary" type="button" onClick={onSetup}>{setupLabel}</button></div> : visibleFields.length ? <div className="field-signal-grid">{visibleFields.map((field) => {
        const fieldSensors = sensors.filter((sensor) => sensor.field_id === field.id);
        const activeFieldSensors = fieldSensors.filter((sensor) => sensor.active);
        const sensorIdsForField = new Set(activeFieldSensors.map((sensor) => sensor.id));
        const fieldReadings = readings.filter((reading) => sensorIdsForField.has(reading.sensor_id));
        const latest = fieldReadings.reduce<Reading | undefined>((current, reading) => !current || Date.parse(reading.ts) > Date.parse(current.ts) ? reading : current, undefined);
        const moistureRows = fieldReadings.filter((reading) => typeof reading.soil_moisture === "number");
        const moisture = moistureRows.length ? moistureRows.reduce((sum, reading) => sum + (reading.soil_moisture ?? 0), 0) / moistureRows.length : null;
        const fieldAlerts = alerts.filter((alert) => alert.field_id === field.id).length;
        const freshCount = activeFieldSensors.filter((sensor) => {
          const sensorLatest = latestReadingBySensor.get(sensor.id);
          return sensorLatest && Date.now() - Date.parse(sensorLatest.ts) <= 60 * 60_000;
        }).length;
        const fresh = activeFieldSensors.length > 0 && freshCount === activeFieldSensors.length;
        const status = fieldAlerts ? "Alerta aberto" : !activeFieldSensors.length ? "Sem sensor ativo" : fresh ? "Sinais recentes" : freshCount ? "Sinal parcial" : "Leitura atrasada";
        return <button type="button" key={field.id} className={`field-signal-card ${selectedFieldId === field.id ? "selected" : ""}`} onClick={() => onSelectField(field.id)} aria-pressed={selectedFieldId === field.id}>
          <span className="field-signal-top"><i className={`crop-dot crop-${field.crop}`}/>{cropLabels[field.crop]}<span className={`field-signal-status ${fieldAlerts ? "attention" : fresh ? "online" : "quiet"}`}><i/>{status}</span></span>
          <strong className="field-signal-name">{shortName(field.name)}</strong>
          <span className="field-moisture-value">{moisture === null ? "—" : number(moisture)}<small>{moisture === null ? "sem dado" : "%"}</small></span>
          <span className="field-moisture-track"><i style={{ width: `${Math.max(0, Math.min(moisture ?? 0, 100))}%` }}/></span>
          <span className="field-signal-meta">{freshCount}/{activeFieldSensors.length} sinais na última hora <span>{ageLabel(latest?.ts)}</span></span>
        </button>;
      })}</div> : <div className="intelligence-state">Nenhum talhão cadastrado para comparar.</div>}
    </section>

    {selectedField && <>
      <section className="panel intelligence-chart-panel">
        <div className="panel-heading chart-heading"><div><span className="muted-eyebrow">SÉRIE DO TALHÃO</span><h2>{selectedField.name}</h2><p>{cropLabels[selectedField.crop]} · {selectedField.area_ha.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha</p></div><div className="intelligence-chart-controls"><div className="segmented-control" role="group" aria-label="Métrica do gráfico">{metrics.map((item) => <button key={item.value} type="button" className={metric === item.value ? "active" : ""} onClick={() => onMetricChange(item.value)}>{item.label}</button>)}</div><div className="segmented-control" role="group" aria-label="Período do gráfico">{[{ value: 1, label: "24h" }, { value: 7, label: "7 dias" }, { value: 30, label: "30 dias" }].map((item) => <button key={item.value} type="button" className={days === item.value ? "active" : ""} onClick={() => onDaysChange(item.value)}>{item.label}</button>)}</div></div></div>
        {seriesLoading ? <div className="chart-loading"><span className="skeleton"/>Carregando série…</div> : seriesError ? <div className="chart-inline-error" role="alert">{seriesError}</div> : <>{chart}<p className="chart-data-note">{series.reduce((sum, point) => sum + (point.readings ?? 0), 0).toLocaleString("pt-BR")} observações agregadas · fonte e período conforme dados disponíveis.</p></>}
      </section>
      <IrrigationResponsePanel field={selectedField} token={token}/>
      <div className="insights-grid intelligence-context-grid"><WeatherPanel token={token} fieldId={selectedField.id}/><ProductionRankingPanel token={token} crop={selectedField.crop} state={state} municipality={municipality}/></div>
    </>}
    <p className="intelligence-footnote">Os indicadores descrevem os registros disponíveis; não são recomendação agronômica nem comprovam causalidade.</p>
  </section>;
}
