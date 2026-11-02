const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function apiUrl(path: string): string {
  return `${PUBLIC_API.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item)).join(" · ");
    }
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Não foi possível concluir a solicitação (HTTP ${status}).`;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isForm = init.body instanceof FormData || init.body instanceof URLSearchParams;
  if (init.body && !isForm && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers, cache: "no-store" });
  } catch {
    throw new Error("Não foi possível conectar à API. Verifique se o serviço está disponível e tente novamente.");
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => "");
    }
    if (
      response.status === 401 &&
      token &&
      body &&
      typeof body === "object" &&
      "detail" in body &&
      (body as { detail?: unknown }).detail === "credenciais inválidas" &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(new CustomEvent("agropulse:unauthorized", { detail: token }));
    }
    throw new ApiError(response.status, errorMessage(response.status, body));
  }
  if (response.status === 204) return undefined as T;
  if (response.status === 205) return undefined as T;
  return response.json() as Promise<T>;
}

export type User = { id: string; name: string; email: string; role: string };
export type Farm = {
  id: string;
  name: string;
  municipality: string;
  state: string;
  location: { type: "Point"; coordinates: [number, number] };
  created_at?: string;
};
export type Field = {
  id: string;
  farm_id: string;
  name: string;
  crop: "soja" | "milho" | "cana" | "cafe" | "trigo" | "algodao";
  area_ha: number;
  boundary: { type: "Polygon"; coordinates: [number, number][][] };
  centroid?: { type: "Point"; coordinates: [number, number] };
  attributes?: Record<string, unknown>;
  created_at?: string;
};
export type Season = {
  id: string;
  field_id: string;
  label: string;
  crop?: Field["crop"];
  planting_date: string;
  harvest_date?: string | null;
  expected_yield_kg_ha?: number | null;
  yield_kg_ha?: number | null;
  status: "planejada" | "em_andamento" | "colhida";
};
export type Operation = {
  id: string;
  field_id: string;
  season_id?: string | null;
  type: "plantio" | "adubacao" | "aplicacao" | "irrigacao" | "colheita";
  date: string;
  cost_brl?: number | null;
  details: Record<string, unknown>;
};
export type Sensor = { id: string; device_id: string; field_id: string; farm_id: string; active: boolean };
export type SeriesPoint = { bucket: string; value: number; min?: number; max?: number; readings?: number };
export type Reading = {
  sensor_id: string;
  ts: string;
  soil_moisture?: number;
  soil_temp?: number;
  air_temp?: number;
  rainfall_mm?: number;
};
export type WeatherHistory = {
  station: { code: string; name?: string | null; state?: string | null; distance_km: number } | null;
  available_years: number[];
  selected_year: number | null;
  readings: {
    ts: string;
    rain_mm?: number | null;
    air_temp?: number | null;
    humidity?: number | null;
    wind_ms?: number | null;
  }[];
};
export type ProductionRankingRow = {
  municipality: string;
  state: string;
  year: number;
  yield_kg_ha: number;
  production_t: number;
  planted_area_ha: number;
};
export type AlertRule = {
  id: string;
  field_id: string;
  metric: "soil_moisture" | "soil_temp" | "air_temp" | "rainfall_mm";
  operator: "lt" | "gt";
  threshold: number;
  window_minutes: number;
  active: boolean;
};
export type Alert = {
  id?: string;
  _id?: string;
  field_id?: string;
  title?: string;
  message?: string;
  metric?: string;
  value?: number;
  threshold?: number;
  triggered_at?: string;
  status?: string;
  severity?: string;
  created_at?: string;
};

export function entityId(value: { id?: string; _id?: string }): string {
  return value.id ?? value._id ?? "";
}

export function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}
