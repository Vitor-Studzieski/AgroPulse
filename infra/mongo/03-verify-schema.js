const database = db.getSiblingDB("agropulse");
const expectedReadingsTtlDays = typeof EXPECTED_READINGS_TTL_DAYS === "undefined"
  ? 30
  : Number(EXPECTED_READINGS_TTL_DAYS);

function expect(condition, message) {
  if (!condition) {
    throw new Error("falha na verificação do schema: " + message);
  }
}

const readingsInfo = database.getCollectionInfos({ name: "sensor_readings" })[0];
expect(readingsInfo?.type === "timeseries", "sensor_readings precisa ser time series");
expect(
  readingsInfo.options?.timeseries?.timeField === "ts"
    && readingsInfo.options?.timeseries?.metaField === "meta",
  "sensor_readings precisa usar ts e meta",
);
expect(
  Number(readingsInfo.options?.expireAfterSeconds) === expectedReadingsTtlDays * 24 * 60 * 60,
  "TTL de sensor_readings diferente do esperado",
);

const weatherInfo = database.getCollectionInfos({ name: "weather_hourly" })[0];
expect(weatherInfo?.type === "timeseries", "weather_hourly precisa ser time series");
expect(
  weatherInfo.options?.timeseries?.timeField === "ts"
    && weatherInfo.options?.timeseries?.metaField === "station",
  "weather_hourly precisa usar ts e station",
);

const userIndexes = database.users.getIndexes();
expect(
  userIndexes.some((index) => index.key?.email === 1 && index.unique === true),
  "users precisa de índice único por e-mail",
);

const fieldIndexes = database.fields.getIndexes();
expect(
  fieldIndexes.some((index) => index.key?.boundary === "2dsphere"),
  "fields precisa de índice geoespacial em boundary",
);
const cropExplain = database.fields.find({ crop: "soja" }).hint({ crop: 1 }).explain("executionStats");
expect(
  JSON.stringify(cropExplain).includes('"stage":"IXSCAN"'),
  "consulta de cultura com hint precisa usar IXSCAN",
);

const rollupIndexes = database.field_daily_stats.getIndexes();
expect(
  rollupIndexes.some(
    (index) => index.key?.field_id === 1 && index.key?.day === 1 && index.unique === true,
  ),
  "field_daily_stats precisa de chave única por talhão e dia",
);

const invalidFarm = { _id: new ObjectId(), name: "x", state: "mato grosso" };
let validationError;
try {
  database.farms.insertOne(invalidFarm);
} catch (error) {
  validationError = error;
}
if (validationError?.code !== 121) {
  database.farms.deleteOne({ _id: invalidFarm._id });
}
expect(validationError?.code === 121, "farms precisa rejeitar documento inválido");
expect(
  database.farms.countDocuments({ _id: invalidFarm._id }) === 0,
  "documento rejeitado não pode ser persistido",
);

print("verificações do schema AgroPulse aprovadas");
