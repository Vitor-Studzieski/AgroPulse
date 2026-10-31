"""Small dependency-free API fixture for isolated frontend development."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

NOW = datetime.now(timezone.utc).isoformat()
FARM_ID = "650000000000000000000001"
FIELD_ID = "650000000000000000000002"
SEASON_ID = "650000000000000000000003"
DEMO_LON = -50.1994
DEMO_LAT = -22.1110
FIELD_HALF_LAT = 0.05 / 110.574
FIELD_HALF_LON = 0.05 / (111.320 * math.cos(math.radians(DEMO_LAT)))
FIELD_RING = [
    [DEMO_LON - FIELD_HALF_LON, DEMO_LAT - FIELD_HALF_LAT],
    [DEMO_LON + FIELD_HALF_LON, DEMO_LAT - FIELD_HALF_LAT],
    [DEMO_LON + FIELD_HALF_LON, DEMO_LAT + FIELD_HALF_LAT],
    [DEMO_LON - FIELD_HALF_LON, DEMO_LAT + FIELD_HALF_LAT],
    [DEMO_LON - FIELD_HALF_LON, DEMO_LAT - FIELD_HALF_LAT],
]

farms = [
    {
        "id": FARM_ID,
        "name": "Área demonstrativa Fatec Pompéia",
        "municipality": "Pompéia",
        "state": "SP",
        "location": {"type": "Point", "coordinates": [DEMO_LON, DEMO_LAT]},
        "created_at": NOW,
    }
]
fields = [
    {
        "id": FIELD_ID,
        "farm_id": FARM_ID,
        "name": "Talhão demonstrativo (sintético)",
        "crop": "soja",
        "area_ha": 1.0,
        "boundary": {
            "type": "Polygon",
            "coordinates": [FIELD_RING],
        },
        "centroid": {"type": "Point", "coordinates": [DEMO_LON, DEMO_LAT]},
        "attributes": {"origem": "sintética", "uso": "demonstração"},
        "created_at": NOW,
    }
]
seasons = [
    {"id": SEASON_ID, "field_id": FIELD_ID, "crop": "soja", "label": "2026/27", "planting_date": "2026-10-01T00:00:00Z", "status": "em_andamento"}
]
operations: list[dict] = []
sensors = [
    {
        "id": "650000000000000000000005",
        "device_id": "AP-DEMO-001",
        "field_id": FIELD_ID,
        "farm_id": FARM_ID,
        "active": True,
    }
]
rules = [
    {"id": "650000000000000000000004", "field_id": FIELD_ID, "metric": "soil_moisture", "operator": "lt", "threshold": 25, "window_minutes": 30, "active": True}
]
alerts: list[dict] = []
profile = {
    "id": "650000000000000000000000",
    "name": "Produtor Demo",
    "email": "demo@agropulse.dev",
    "role": "produtor",
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _send(self, status: int, payload: object) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        if self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded"):
            return {key: values[-1] for key, values in parse_qs(raw.decode()).items()}
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        if path == "/health":
            return self._send(200, {"status": "ok", "mode": "mock"})
        if path == "/auth/me":
            return self._send(200, profile)
        if path == "/farms":
            return self._send(200, farms)
        if path.startswith("/farms/"):
            return self._send(200, next((item for item in farms if item["id"] == path.rsplit("/", 1)[-1]), farms[0]))
        if path == "/fields":
            farm_id = query.get("farm_id", [FARM_ID])[0]
            return self._send(200, [item for item in fields if item["farm_id"] == farm_id])
        if path.startswith("/fields/") and path.endswith("/readings/latest"):
            return self._send(200, [{"sensor_id": "sensor-demo-1", "ts": NOW, "soil_moisture": 38.4, "soil_temp": 24.2, "air_temp": 29.1, "rainfall_mm": 0.0}])
        if path == "/seasons":
            return self._send(200, seasons)
        if path == "/operations":
            field_id = query.get("field_id", [None])[0]
            return self._send(200, [item for item in operations if not field_id or item["field_id"] == field_id])
        if path == "/sensors":
            field_id = query.get("field_id", [None])[0]
            return self._send(200, [item for item in sensors if not field_id or item["field_id"] == field_id])
        if path == "/alert-rules":
            return self._send(200, rules)
        if path == "/alerts":
            return self._send(200, alerts)
        if path == "/analytics/fields/" + FIELD_ID + "/series":
            return self._send(200, [{"bucket": NOW, "value": 38.4, "min": 31.0, "max": 44.2, "readings": 12}])
        if path == "/analytics/fields/" + FIELD_ID + "/weather":
            return self._send(
                200,
                {
                    "station": {
                        "code": "A763",
                        "name": "Marília",
                        "state": "SP",
                        "distance_km": 27.8,
                    },
                    "available_years": [],
                    "selected_year": None,
                    "readings": [],
                },
            )
        match = re.fullmatch(r"/analytics/farms/[^/]+/summary", path)
        if match:
            return self._send(200, [{"crop": "soja", "fields": len(fields), "area_ha": sum(f["area_ha"] for f in fields)}])
        if path == "/analytics/production/ranking":
            ranking = [{"municipality": "Sorriso", "state": "MT", "year": 2023, "yield_kg_ha": 3750, "production_t": 2244375, "planted_area_ha": 598500}]
            selected_state = query.get("state", [None])[0]
            return self._send(200, [row for row in ranking if not selected_state or row["state"] == selected_state])
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        body = self._body()
        if path == "/auth/login":
            return self._send(200, {"access_token": "mock-token", "token_type": "bearer"})
        if path == "/auth/register":
            profile.update(
                {
                    "name": body.get("name", "Produtor Demo"),
                    "email": body.get("email", "demo@agropulse.dev"),
                }
            )
            return self._send(201, profile)
        collection = {"/farms": farms, "/fields": fields, "/seasons": seasons, "/operations": operations, "/sensors": sensors, "/alert-rules": rules}
        if path in collection:
            item = {**body, "id": f"mock-{len(collection[path]) + 1}", "created_at": NOW}
            if path == "/farms":
                item.setdefault("location", {"type": "Point", "coordinates": [DEMO_LON, DEMO_LAT]})
                farms.append(item)
            elif path == "/fields":
                item.setdefault("area_ha", 1)
                item.setdefault("boundary", fields[0]["boundary"])
                item.setdefault("centroid", fields[0]["centroid"])
                item.setdefault("attributes", {})
                fields.append(item)
            elif path == "/sensors":
                field = next((candidate for candidate in fields if candidate["id"] == item.get("field_id")), fields[0])
                item.update({"field_id": field["id"], "farm_id": field["farm_id"], "active": item.get("active", True)})
                sensors.append(item)
            else:
                collection[path].append(item)
            return self._send(201, item)
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        body = self._body()
        if path == "/auth/me":
            profile.update({key: body[key] for key in ("name", "email") if key in body})
            return self._send(200, profile)
        for prefix, items in (("/farms/", farms), ("/fields/", fields), ("/seasons/", seasons), ("/operations/", operations), ("/sensors/", sensors), ("/alert-rules/", rules)):
            if path.startswith(prefix):
                item_id = path[len(prefix):]
                item = next((entry for entry in items if entry["id"] == item_id), None)
                if item is None:
                    return self._send(404, {"detail": "not found"})
                item.update(body)
                if prefix == "/sensors/" and "field_id" in body:
                    field = next((candidate for candidate in fields if candidate["id"] == item["field_id"]), None)
                    if field:
                        item["farm_id"] = field["farm_id"]
                return self._send(200, item)
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path == "/auth/me":
            farms.clear()
            fields.clear()
            seasons.clear()
            operations.clear()
            sensors.clear()
            rules.clear()
            alerts.clear()
            self.send_response(204)
            self.end_headers()
            return
        for prefix, items in (("/farms/", farms), ("/fields/", fields), ("/seasons/", seasons), ("/operations/", operations), ("/sensors/", sensors), ("/alert-rules/", rules)):
            if path.startswith(prefix):
                item_id = path[len(prefix):]
                items[:] = [item for item in items if item["id"] != item_id]
                self.send_response(204)
                self.end_headers()
                return
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
