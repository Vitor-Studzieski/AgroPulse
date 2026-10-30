# Modelo de dados

Banco: `agropulse`. O schema é criado por `infra/mongo/02-schema.js`.

## Coleções

| Coleção | Tipo | Conteúdo | Índices |
|---|---|---|---|
| `users` | comum + validação | Usuários e papéis | `email` único |
| `farms` | comum + validação | Fazendas, `location` Point | `owner_id`; `location` 2dsphere |
| `fields` | comum + validação | Talhões com `boundary` Polygon, `centroid`, `attributes` livres | `farm_id,name`; `boundary` e `centroid` 2dsphere; `crop` |
| `seasons` | comum + validação | Safras por talhão | `field_id,label` |
| `operations` | comum + validação | Plantio, adubação, aplicação, irrigação, colheita; `details` varia por tipo | `field_id,date`; `season_id` |
| `sensors` | comum + validação | Dispositivos | `device_id` único; `field_id` |
| `sensor_readings` | **time series** (minutos, TTL 180 d) | Umidade, temperatura e chuva | `meta.field_id,ts`; `meta.sensor_id,ts` |
| `weather_stations` | comum | Estações INMET | `code` único; `location` 2dsphere |
| `weather_hourly` | **time series** (horas) | Clima horário INMET | `station.code,ts` |
| `ibge_production` | comum | Produção agrícola municipal | `ibge_code,crop,year` único; `crop,year,yield_kg_ha` |
| `field_daily_stats` | comum (alvo de `$merge`) | Resumo por talhão e dia | `field_id,day` único |
| `alert_rules` | comum + validação | Regras (métrica, operador, limiar, janela) | `active,field_id` |
| `alerts` | comum + validação | Alertas abertos e resolvidos | `field_id,triggered_at`; `rule_id,status` |

## Exemplos de documentos

`sensor_readings`

```json
{
  "ts": "2026-10-29T14:05:00Z",
  "meta": { "sensor_id": "ObjectId", "field_id": "ObjectId", "farm_id": "ObjectId" },
  "soil_moisture": 31.42,
  "soil_temp": 26.1,
  "air_temp": 29.8,
  "rainfall_mm": 0.0
}
```

`fields`

```json
{
  "farm_id": "ObjectId",
  "name": "Talhão 001",
  "crop": "soja",
  "area_ha": 100.02,
  "boundary": { "type": "Polygon", "coordinates": [[[-55.73, -12.55], [-55.71, -12.55], [-55.71, -12.53], [-55.73, -12.53], [-55.73, -12.55]]] },
  "centroid": { "type": "Point", "coordinates": [-55.72, -12.54] },
  "attributes": { "solo": "latossolo", "irrigado": true }
}
```

## Consultas para o relatório

Rode no mongosh (`docker compose exec mongo mongosh agropulse`) e tire print do comando e do resultado.

```js
db.sensor_readings.countDocuments()

db.getCollectionInfos({ name: "sensor_readings" })

db.fields.find({ boundary: { $geoIntersects: { $geometry: { type: "Point", coordinates: [-55.72, -12.54] } } } })

db.weather_stations.find({ location: { $near: { $geometry: { type: "Point", coordinates: [-55.72, -12.54] }, $maxDistance: 100000 } } })

db.sensor_readings.aggregate([
  { $match: { ts: { $gte: new Date(Date.now() - 7 * 864e5) } } },
  { $group: { _id: { field: "$meta.field_id", day: { $dateTrunc: { date: "$ts", unit: "day" } } }, avg: { $avg: "$soil_moisture" } } },
  { $sort: { "_id.day": 1 } }
])

db.fields.explain("executionStats").find({ crop: "soja" })

```

Teste de validação (deve falhar):

```js
db.farms.insertOne({ name: "x", state: "mato grosso" })
```
