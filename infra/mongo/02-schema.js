const database = db.getSiblingDB("agropulse");
const DAY = 60 * 60 * 24;
const readingsTtlDays = typeof READINGS_TTL_DAYS === "undefined"
  ? 180
  : Number(READINGS_TTL_DAYS);

if (!Number.isInteger(readingsTtlDays) || readingsTtlDays < 1) {
  throw new Error("READINGS_TTL_DAYS precisa ser um inteiro positivo");
}

const position = {
  bsonType: "array",
  minItems: 2,
  maxItems: 2,
  items: { bsonType: "number" },
};

const point = {
  bsonType: "object",
  required: ["type", "coordinates"],
  properties: { type: { enum: ["Point"] }, coordinates: position },
};

const polygon = {
  bsonType: "object",
  required: ["type", "coordinates"],
  properties: {
    type: { enum: ["Polygon"] },
    coordinates: {
      bsonType: "array",
      minItems: 1,
      items: { bsonType: "array", minItems: 4, items: position },
    },
  },
};

const crops = ["soja", "milho", "cana", "cafe", "trigo", "algodao"];

function validated(schema) {
  return {
    validator: { $jsonSchema: schema },
    validationLevel: "strict",
    validationAction: "error",
  };
}

function ensureCollection(name, options) {
  if (database.getCollectionNames().includes(name)) {
    if (options.validator) {
      database.runCommand({ collMod: name, ...options });
    }
    return;
  }
  database.createCollection(name, options);
  print("coleção criada: " + name);
}

ensureCollection("users", validated({
  bsonType: "object",
  required: ["email", "name", "password_hash", "role", "created_at"],
  properties: {
    email: { bsonType: "string" },
    name: { bsonType: "string" },
    password_hash: { bsonType: "string" },
    role: { enum: ["admin", "produtor", "tecnico"] },
    created_at: { bsonType: "date" },
  },
}));

ensureCollection("farms", validated({
  bsonType: "object",
  required: ["owner_id", "name", "state", "location", "created_at"],
  properties: {
    owner_id: { bsonType: "objectId" },
    name: { bsonType: "string", minLength: 2 },
    municipality: { bsonType: "string" },
    state: { bsonType: "string", pattern: "^[A-Z]{2}$" },
    location: point,
    created_at: { bsonType: "date" },
  },
}));

ensureCollection("fields", validated({
  bsonType: "object",
  required: ["farm_id", "name", "crop", "area_ha", "boundary", "centroid", "created_at"],
  properties: {
    farm_id: { bsonType: "objectId" },
    name: { bsonType: "string" },
    crop: { enum: crops },
    area_ha: { bsonType: "number", minimum: 0 },
    boundary: polygon,
    centroid: point,
    attributes: { bsonType: "object" },
    created_at: { bsonType: "date" },
  },
}));

ensureCollection("seasons", validated({
  bsonType: "object",
  required: ["field_id", "crop", "label", "planting_date", "status"],
  properties: {
    field_id: { bsonType: "objectId" },
    crop: { enum: crops },
    label: { bsonType: "string" },
    planting_date: { bsonType: "date" },
    harvest_date: { bsonType: "date" },
    expected_yield_kg_ha: { bsonType: "number", minimum: 0 },
    yield_kg_ha: { bsonType: "number", minimum: 0 },
    status: { enum: ["planejada", "em_andamento", "colhida"] },
  },
}));

ensureCollection("operations", validated({
  bsonType: "object",
  required: ["field_id", "type", "date"],
  properties: {
    field_id: { bsonType: "objectId" },
    season_id: { bsonType: "objectId" },
    type: { enum: ["plantio", "adubacao", "aplicacao", "irrigacao", "colheita"] },
    date: { bsonType: "date" },
    cost_brl: { bsonType: "number", minimum: 0 },
    details: { bsonType: "object" },
  },
}));

ensureCollection("sensors", validated({
  bsonType: "object",
  required: ["device_id", "field_id", "farm_id", "active"],
  properties: {
    device_id: { bsonType: "string" },
    field_id: { bsonType: "objectId" },
    farm_id: { bsonType: "objectId" },
    active: { bsonType: "bool" },
  },
}));

ensureCollection("alert_rules", validated({
  bsonType: "object",
  required: ["field_id", "metric", "operator", "threshold", "window_minutes", "active"],
  properties: {
    field_id: { bsonType: "objectId" },
    metric: { enum: ["soil_moisture", "soil_temp", "air_temp", "rainfall_mm"] },
    operator: { enum: ["lt", "gt"] },
    threshold: { bsonType: "number" },
    window_minutes: { bsonType: "int", minimum: 1 },
    active: { bsonType: "bool" },
  },
}));

ensureCollection("alerts", validated({
  bsonType: "object",
  required: ["rule_id", "field_id", "metric", "value", "threshold", "status", "triggered_at"],
  properties: {
    rule_id: { bsonType: "objectId" },
    field_id: { bsonType: "objectId" },
    metric: { bsonType: "string" },
    value: { bsonType: "number" },
    threshold: { bsonType: "number" },
    status: { enum: ["open", "resolved"] },
    triggered_at: { bsonType: "date" },
    resolved_at: { bsonType: "date" },
    notified_at: { bsonType: "date" },
    notification_claimed_at: { bsonType: "date" },
  },
}));

ensureCollection("sensor_readings", {
  timeseries: { timeField: "ts", metaField: "meta", granularity: "minutes" },
  expireAfterSeconds: readingsTtlDays * DAY,
});
database.runCommand({
  collMod: "sensor_readings",
  expireAfterSeconds: readingsTtlDays * DAY,
});

ensureCollection("weather_hourly", {
  timeseries: { timeField: "ts", metaField: "station", granularity: "hours" },
});

ensureCollection("weather_stations", {});
ensureCollection("ibge_production", {});
ensureCollection("field_daily_stats", {});

database.users.createIndex({ email: 1 }, { unique: true });

database.farms.createIndex({ owner_id: 1 });
database.farms.createIndex({ location: "2dsphere" });

database.fields.createIndex({ farm_id: 1, name: 1 });
database.fields.createIndex({ boundary: "2dsphere" });
database.fields.createIndex({ centroid: "2dsphere" });
database.fields.createIndex({ crop: 1 });

database.seasons.createIndex({ field_id: 1, label: -1 });
database.operations.createIndex({ field_id: 1, date: -1 });
database.operations.createIndex({ season_id: 1 });

database.sensors.createIndex({ device_id: 1 }, { unique: true });
database.sensors.createIndex({ field_id: 1 });

database.alert_rules.createIndex({ active: 1, field_id: 1 });
database.alerts.createIndex({ field_id: 1, triggered_at: -1 });
database.alerts.createIndex({ rule_id: 1, status: 1 });

database.sensor_readings.createIndex({ "meta.field_id": 1, ts: -1 });
database.sensor_readings.createIndex({ "meta.sensor_id": 1, ts: -1 });
database.weather_hourly.createIndex({ "station.code": 1, ts: -1 });

database.weather_stations.createIndex({ code: 1 }, { unique: true });
database.weather_stations.createIndex({ location: "2dsphere" });

database.ibge_production.createIndex({ ibge_code: 1, crop: 1, year: 1 }, { unique: true });
database.ibge_production.createIndex({ crop: 1, year: -1, yield_kg_ha: -1 });

database.field_daily_stats.createIndex({ field_id: 1, day: 1 }, { unique: true });

print("schema AgroPulse pronto: " + database.getCollectionNames().sort().join(", "));
