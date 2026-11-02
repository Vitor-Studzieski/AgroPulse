"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SeriesPoint } from "@/lib/api";

type Props = {
  data: SeriesPoint[];
  unit: string;
  bucketUnit: "hour" | "day";
};

function dateLabel(value: string, withTime: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(
    "pt-BR",
    withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" },
  ).format(date);
}

function formatNumber(value: number, fraction = 0): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: fraction,
    minimumFractionDigits: fraction,
  }).format(value);
}

export default function TelemetryChart({ data, unit, bucketUnit }: Props) {
  if (!data.length) {
    return <div className="chart-empty"><span className="empty-illustration" aria-hidden="true"><svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg></span><strong>Ainda não há leituras neste período</strong><span>Quando os sensores enviarem dados, a série aparecerá aqui.</span></div>;
  }

  const latest = data.at(-1);
  const periodLabel = bucketUnit === "hour" ? "hora" : "dia";
  return <div className="chart-wrap">
    <div className="chart-current"><strong>{formatNumber(latest?.value ?? 0, 1)} <small>{unit}</small></strong><span>ponto mais recente</span></div>
    <div className="chart-scroll" role="img" aria-label={`Gráfico de ${unit} por ${periodLabel}`}>
      <div className="chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 12, right: 14, left: 4, bottom: 2 }} accessibilityLayer>
            <defs><linearGradient id="telemetryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-sensor-1)" stopOpacity={0.24}/><stop offset="100%" stopColor="var(--chart-sensor-1)" stopOpacity={0.02}/></linearGradient></defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="4 5" vertical={false}/>
            <XAxis dataKey="bucket" tickFormatter={(value: string) => dateLabel(value, bucketUnit === "hour")} tick={{ fill: "var(--color-ink-muted)" }} tickLine={false} axisLine={false} minTickGap={28}/>
            <YAxis domain={["auto", "auto"]} tickFormatter={(value: number) => formatNumber(value, 0)} tick={{ fill: "var(--color-ink-muted)" }} tickLine={false} axisLine={false} width={42}/>
            {unit === "%" && <ReferenceLine y={20} stroke="var(--color-critical)" strokeDasharray="6 5" label={{ value: "Limite 20%", fill: "var(--color-critical)", position: "insideTopRight" }}/>}
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0]?.payload as SeriesPoint | undefined;
                if (!point) return null;
                return <div className="chart-tooltip"><strong>{dateLabel(String(label), bucketUnit === "hour")}</strong><span>{formatNumber(point.value, 1)} {unit}</span><small>mín. {formatNumber(point.min ?? point.value, 1)} · máx. {formatNumber(point.max ?? point.value, 1)} · {point.readings ?? 0} leituras</small></div>;
              }}
            />
            <Area dataKey="value" type="monotone" stroke="var(--chart-sensor-1)" strokeWidth={2} fill="url(#telemetryFill)" activeDot={{ r: 5, strokeWidth: 2, fill: "var(--color-surface)" }} dot={data.length < 3 ? { r: 3, fill: "var(--color-surface)", strokeWidth: 2 } : false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  </div>;
}
