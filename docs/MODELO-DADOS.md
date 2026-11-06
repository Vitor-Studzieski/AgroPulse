# Modelo de dados

Banco: `agropulse`. O schema é criado por `infra/mongo/02-schema.js`.

## Coleções

| Coleção | Tipo | Conteúdo | Índices |
|---|---|---|---|
| `users` | comum + validação | Usuários e papéis | `email` único |
| `farms` | comum + validação | Fazendas, `location` Point | `owner_id`; `location` 2dsphere |
| `fields` | comum + validação | Talhões com `boundary` Polygon, `centroid`, `attributes` livres | `farm_id,name`; `boundary` e `centroid` 2dsphere; `crop` |
| `seasons` | comum + validação | Safras por talhão | `field_id,label` |
| `operations` | comum + validação | Plantio, adubação, aplicação, irrigação, colheita; `details` varia por tipo e guarda origem real/fictícia, custos, comprovantes e histórico de auditoria | `field_id,date`; `season_id` |
| `operation_attachments.files/chunks` | GridFS | PDFs e imagens anexados às atividades, com metadados de operação e usuário | Índices GridFS por `files_id` |
| `sensors` | comum + validação | Dispositivos, origem `simulated`/`real` e ponto de instalação dentro do talhão | `device_id` único; `field_id`; `location` 2dsphere |
| `sensor_readings` | **time series** (minutos, TTL configurável: 180 d local, 30 d produção) | Umidade, temperatura e chuva | `meta.field_id,ts`; `meta.sensor_id,ts` |
| `weather_stations` | comum | Estações INMET | `code` único; `location` 2dsphere |
| `weather_hourly` | **time series** (horas) | Clima horário INMET | `station.code,ts` |
| `ibge_production` | comum | Produção agrícola municipal | `ibge_code,crop,year` único; `crop,year,yield_kg_ha` |
| `field_daily_stats` | comum (alvo de `$merge`) | Resumo por talhão e dia | `field_id,day` único |
| `alert_rules` | comum + validação | Regras (métrica, operador, limiar, janela) | `active,field_id` |
| `alerts` | comum + validação | Alertas abertos e resolvidos, estado de entrega opcional | `field_id,triggered_at`; `rule_id,status` |

O endpoint de talhões valida coordenadas WGS84, exige anéis fechados, rejeita cruzamentos e anéis internos fora ou sobrepostos ao contorno externo, e requer área líquida positiva. `area_ha` desconta os anéis internos e o centroide é ponderado pela área; ambos usam uma projeção local aproximada adequada a talhões agrícolas. A geometria original permanece em GeoJSON.

O seed de apresentação usa como referência única o campus da Fatec Pompéia (latitude `-22.1110`, longitude `-50.1994`). Os pequenos polígonos gerados ao redor do ponto são sintéticos e servem apenas para demonstrar o mapa; não são levantamento, limite cadastral nem afirmação de que exista um talhão agrícola no campus. O mock da interface mostra a estação automática do INMET em Marília (A763), a aproximadamente 27,8 km; ele não inventa observações climáticas quando nenhum histórico oficial foi importado.

## Exemplos de documentos

`sensor_readings`

```json
{
  "ts": "2026-10-29T14:05:00Z",
  "meta": { "sensor_id": "ObjectId", "field_id": "ObjectId", "farm_id": "ObjectId", "source": "simulated", "simulation_version": "2.0" },
  "soil_moisture": 31.42,
  "soil_temp": 26.1,
  "air_temp": 29.8,
  "rainfall_mm": 0.0
}
```

### Dados simulados dos sensores

O worker gera dados apenas para sensores ativos com origem `simulated`; sensores `real` não recebem leituras artificiais. Sensores do mesmo talhão compartilham a mesma série sintética de chuva e o mesmo perfil de temperatura com pequenas variações por instrumento. A umidade do solo responde à chuva, às irrigações registradas como simuladas, ao horário do dia e à cultura. `meta.source` e `meta.simulation_version` identificam os dados produzidos pelo modelo.

Esse modelo cria sinais plausíveis para demonstração e validação de fluxos da interface. Ele não é calibrado com sensores físicos, propriedades do solo, estação meteorológica ou ensaios de campo; não deve ser usado como recomendação agronômica. As séries de chuva calculam o acumulado por sensor e depois a média entre sensores, para que a quantidade de dispositivos não multiplique a precipitação do talhão.

Sensores novos recebem coordenadas dentro do polígono do talhão. Ao listar um sensor legado sem localização, a API escolhe e persiste uma posição interna determinística, distribuída em relação às demais posições válidas. Alterar o talhão no formulário de sensor também atualiza o vínculo e valida a posição no novo contorno.

`fields`

```json
{
  "farm_id": "ObjectId",
  "name": "Talhão 001",
  "crop": "soja",
  "area_ha": 1.0,
  "boundary": { "type": "Polygon", "coordinates": [[[-50.199884, -22.111452], [-50.198916, -22.111452], [-50.198916, -22.110548], [-50.199884, -22.110548], [-50.199884, -22.111452]]] },
  "centroid": { "type": "Point", "coordinates": [-50.1994, -22.111] },
  "attributes": { "origem": "sintética", "uso": "demonstração" }
}
```

## Fluxos da API

Todos os endpoints abaixo, exceto cadastro e login, exigem `Authorization: Bearer <token>`. O contrato completo e os schemas de requisição e resposta ficam disponíveis em `/docs`.

Nos `PATCH`, a API rejeita `null` explícito para campos obrigatórios, em vez de ignorar a alteração e responder sucesso. Campos opcionais que podem ser limpos — como a data de colheita, as produtividades, o custo e o vínculo de safra da operação — aceitam `null`.

| Método e rota | Uso |
|---|---|
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | Criar conta, autenticar e consultar o perfil |
| `PATCH /auth/me` | Alterar nome, e-mail e/ou senha; exige `current_password` |
| `DELETE /auth/me` | Excluir conta e dados vinculados; exige confirmação pela senha atual |
| `/farms`, `/fields`, `/seasons`, `/operations`, `/sensors`, `/alert-rules`, `/alerts` | CRUD dos recursos pertencentes ao usuário autenticado |
| `GET /analytics/fields/{id}/series` | Série horária ou diária de uma métrica do talhão |
| `GET /analytics/fields/{id}/irrigation-response` | Compara a média por sensor da umidade nas janelas antes/depois de cada irrigação; informa sensores e leituras usados e a variação em pontos percentuais |
| `GET /analytics/fields/{id}/weather` | Últimos dias ou ano-calendário completo da estação INMET mais próxima em até 100 km; resposta lista os anos importados |
| `GET /analytics/production/ranking` | Ranking municipal IBGE; escolhe o ano mais recente se `year` for omitido |

Excluir uma conta, fazenda ou talhão remove os registros dependentes por `field_id`. Leituras em `sensor_readings` são removidas por `meta.field_id`; o TTL continua limitando a retenção normal dos dados brutos.

A consulta de resposta à irrigação usa a data registrada da operação como divisor de duas janelas iguais (24 horas por padrão). Ela calcula primeiro a média de cada sensor em cada janela e depois a média entre sensores, evitando que dispositivos com mais amostras pesem mais no resultado. A comparação é temporal e não demonstra causalidade; a origem real/fictícia do evento e a quantidade de amostras acompanham o resultado.

O seed é idempotente para a conta, fazenda, talhões, sensores e regras de demonstração: uma execução seguinte alinha a fazenda e as geometrias geradas à referência do campus, repara sensores ou regras ausentes e preserva leituras e operações já registradas. Ele aceita `--fields` e `--sensors-per-field`, ambos positivos.

Em `alerts`, `notification_claimed_at` é uma concessão temporária do worker e `notified_at` indica uma entrega concluída (ou apenas registrada em log quando não há webhook configurado). Uma falha no webhook libera o alerta para nova tentativa; essas datas são campos operacionais opcionais.

## Consultas para o relatório

Rode no mongosh (`docker compose exec mongo mongosh agropulse`) e tire print do comando e do resultado.

```js
db.sensor_readings.countDocuments()

db.getCollectionInfos({ name: "sensor_readings" })

db.fields.find({ boundary: { $geoIntersects: { $geometry: { type: "Point", coordinates: [-50.1994, -22.1110] } } } })

db.weather_stations.find({ location: { $near: { $geometry: { type: "Point", coordinates: [-50.1994, -22.1110] }, $maxDistance: 100000 } } })

db.sensor_readings.aggregate([
  { $match: { ts: { $gte: new Date(Date.now() - 7 * 864e5) } } },
  { $group: { _id: { field: "$meta.field_id", day: { $dateTrunc: { date: "$ts", unit: "day" } } }, avg: { $avg: "$soil_moisture" } } },
  { $sort: { "_id.day": 1 } }
])

db.fields.find({ crop: "soja" }).hint({ crop: 1 }).explain("executionStats").queryPlanner.winningPlan

```

O `hint` torna a demonstração do `IXSCAN` reproduzível com os três talhões pequenos do seed; sem ele, o otimizador pode escolher `COLLSCAN` para uma coleção tão pequena.

Teste de validação (deve falhar):

```js
db.farms.insertOne({ name: "x", state: "mato grosso" })
```
