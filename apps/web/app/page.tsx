import { apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

async function apiIsHealthy(): Promise<boolean> {
  try {
    await apiFetch<{ status: string }>("/health");
    return true;
  } catch {
    return false;
  }
}

const modules = [
  { title: "Fazendas e talhões", detail: "CRUD com polígonos GeoJSON no mapa" },
  { title: "Telemetria", detail: "Leituras de sensores em time series" },
  { title: "Clima INMET", detail: "Estações próximas e histórico horário" },
  { title: "Alertas", detail: "Regras por talhão com notificação em tempo real" },
];

export default async function Home() {
  const healthy = await apiIsHealthy();

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">AgroPulse</h1>
      <p className="mt-2 text-stone-600">Monitoramento de safra com telemetria e clima.</p>

      <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-3 py-1 text-sm">
        <span className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-red-500"}`} />
        API {healthy ? "online" : "indisponível"}
      </p>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2">
        {modules.map((item) => (
          <li key={item.title} className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="font-medium">{item.title}</h2>
            <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
