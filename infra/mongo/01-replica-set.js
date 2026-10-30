try {
  rs.status();
  print("replica set já iniciado");
} catch (e) {
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  print("replica set iniciado");
}

for (let i = 0; i < 60; i++) {
  if (db.hello().isWritablePrimary) {
    break;
  }
  sleep(1000);
}
