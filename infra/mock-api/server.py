"""Small dependency-free API fixture for isolated frontend development."""

from __future__ import annotations

import json
import math
import re
import threading
from copy import deepcopy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

NOW = datetime.now(timezone.utc).isoformat()
FARM_ID = "650000000000000000000001"
FIELD_ID = "650000000000000000000002"
SEASON_ID = "650000000000000000000003"
DEMO_LON = -50.1994
DEMO_LAT = -22.1110
DEMO_PROFILE_ID = "650000000000000000000000"
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
        "location": {"type": "Point", "coordinates": [DEMO_LON, DEMO_LAT]},
        "source": "simulated",
        "active": True,
    }
]
rules = [
    {"id": "650000000000000000000004", "field_id": FIELD_ID, "metric": "soil_moisture", "operator": "lt", "threshold": 25, "window_minutes": 30, "active": True}
]
alerts: list[dict] = []
profile = {
    "id": DEMO_PROFILE_ID,
    "name": "Produtor Demo",
    "email": "demo@agropulse.dev",
    "role": "produtor",
}

_SEED_FARMS = deepcopy(farms)
_SEED_FIELDS = deepcopy(fields)
_SEED_SEASONS = deepcopy(seasons)
_SEED_OPERATIONS = deepcopy(operations)
_SEED_SENSORS = deepcopy(sensors)
_SEED_RULES = deepcopy(rules)
_SEED_ALERTS = deepcopy(alerts)

accounts_by_id = {DEMO_PROFILE_ID: {"profile": profile, "password": "demo12345"}}
accounts_by_email = {profile["email"]: DEMO_PROFILE_ID}
tokens: dict[str, str] = {}
next_user_number = 1
next_record_number = 2
store_lock = threading.RLock()


def reset_state() -> None:
    """Restore the process-local demo fixture; used by the focused mock API tests."""
    global farms, fields, seasons, operations, sensors, rules, alerts, profile
    global accounts_by_id, accounts_by_email, tokens, next_user_number, next_record_number
    profile = {
        "id": DEMO_PROFILE_ID,
        "name": "Produtor Demo",
        "email": "demo@agropulse.dev",
        "role": "produtor",
    }
    farms = deepcopy(_SEED_FARMS)
    fields = deepcopy(_SEED_FIELDS)
    seasons = deepcopy(_SEED_SEASONS)
    operations = deepcopy(_SEED_OPERATIONS)
    sensors = deepcopy(_SEED_SENSORS)
    rules = deepcopy(_SEED_RULES)
    alerts = deepcopy(_SEED_ALERTS)
    accounts_by_id = {DEMO_PROFILE_ID: {"profile": profile, "password": "demo12345"}}
    accounts_by_email = {profile["email"]: DEMO_PROFILE_ID}
    tokens = {}
    next_user_number = 1
    next_record_number = 2


def _owner_id(item: dict) -> str:
    return item.get("_owner_id", DEMO_PROFILE_ID)


def _visible(item: dict) -> dict:
    return {key: value for key, value in item.items() if not key.startswith("_")}


def _request_fields(body: dict) -> dict:
    return {key: value for key, value in body.items() if not key.startswith("_")}


def _visible_items(items: list[dict], owner_id: str, field_id: str | None = None) -> list[dict]:
    return [
        _visible(item)
        for item in items
        if _owner_id(item) == owner_id and (field_id is None or item.get("field_id") == field_id)
    ]


def _owned_item(items: list[dict], item_id: str, owner_id: str) -> dict | None:
    return next(
        (item for item in items if item["id"] == item_id and _owner_id(item) == owner_id),
        None,
    )


def _new_record_id() -> str:
    global next_record_number
    record_id = f"mock-{next_record_number}"
    next_record_number += 1
    return record_id


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def _send(self, status: int, payload: object = None) -> None:
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        if status == 204:
            self.end_headers()
            return
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        if self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded"):
            return {key: values[-1] for key, values in parse_qs(raw.decode()).items()}
        try:
            payload = json.loads(raw or b"{}")
            return payload if isinstance(payload, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _user(self) -> dict | None:
        authorization = self.headers.get("Authorization", "")
        token = authorization.removeprefix("Bearer ") if authorization.startswith("Bearer ") else ""
        user_id = tokens.get(token)
        account = accounts_by_id.get(user_id or "")
        if account is None:
            self._send(401, {"detail": "credenciais inválidas"})
            return None
        return account

    def _check_password(self, account: dict, password: object) -> bool:
        return isinstance(password, str) and password == account["password"]

    def _delete_owned_field_data(self, owner_id: str, field_ids: set[str]) -> None:
        seasons[:] = [
            item for item in seasons
            if not (_owner_id(item) == owner_id and item.get("field_id") in field_ids)
        ]
        operations[:] = [
            item for item in operations
            if not (_owner_id(item) == owner_id and item.get("field_id") in field_ids)
        ]
        sensors[:] = [
            item for item in sensors
            if not (_owner_id(item) == owner_id and item.get("field_id") in field_ids)
        ]
        rules[:] = [
            item for item in rules
            if not (_owner_id(item) == owner_id and item.get("field_id") in field_ids)
        ]
        alerts[:] = [
            item for item in alerts
            if not (_owner_id(item) == owner_id and item.get("field_id") in field_ids)
        ]

    def _delete_owned_farm(self, owner_id: str, farm_id: str) -> bool:
        farm = _owned_item(farms, farm_id, owner_id)
        if farm is None:
            return False
        field_ids = {
            item["id"]
            for item in fields
            if _owner_id(item) == owner_id and item.get("farm_id") == farm_id
        }
        fields[:] = [
            item for item in fields
            if not (_owner_id(item) == owner_id and item.get("farm_id") == farm_id)
        ]
        self._delete_owned_field_data(owner_id, field_ids)
        farms.remove(farm)
        return True

    def _delete_account(self, owner_id: str) -> None:
        owned_field_ids = {item["id"] for item in fields if _owner_id(item) == owner_id}
        self._delete_owned_field_data(owner_id, owned_field_ids)
        for collection in (farms, fields):
            collection[:] = [item for item in collection if _owner_id(item) != owner_id]
        # Also remove any orphaned records created by older mock versions.
        for collection in (seasons, operations, sensors, rules, alerts):
            collection[:] = [item for item in collection if _owner_id(item) != owner_id]
        account = accounts_by_id.pop(owner_id, None)
        if account:
            accounts_by_email.pop(account["profile"]["email"], None)
        for token, user_id in list(tokens.items()):
            if user_id == owner_id:
                del tokens[token]

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        query = parse_qs(parsed.query)
        if path == "/health":
            return self._send(200, {"status": "ok", "mode": "mock"})
        account = self._user()
        if account is None:
            return
        profile = account["profile"]
        owner_id = profile["id"]
        if path == "/auth/me":
            return self._send(200, _visible(profile))
        if path == "/farms":
            return self._send(200, _visible_items(farms, owner_id))
        if path.startswith("/farms/"):
            item = _owned_item(farms, path.rsplit("/", 1)[-1], owner_id)
            return self._send(200, _visible(item)) if item else self._send(404, {"detail": "not found"})
        if path == "/fields":
            farm_id = query.get("farm_id", [None])[0]
            if farm_id and _owned_item(farms, farm_id, owner_id) is None:
                return self._send(404, {"detail": "fazenda não encontrada"})
            owned_fields = _visible_items(fields, owner_id)
            if farm_id is not None:
                owned_fields = [item for item in owned_fields if item.get("farm_id") == farm_id]
            return self._send(200, owned_fields)
        readings_match = re.fullmatch(r"/fields/([^/]+)/readings/latest", path)
        if readings_match:
            field = _owned_item(fields, readings_match.group(1), owner_id)
            if field is None:
                return self._send(404, {"detail": "talhão não encontrado"})
            sensor = next((item for item in sensors if _owner_id(item) == owner_id and item.get("field_id") == field["id"]), None)
            if sensor is None:
                return self._send(200, [])
            return self._send(200, [{"sensor_id": sensor["id"], "ts": NOW, "soil_moisture": 38.4, "soil_temp": 24.2, "air_temp": 29.1, "rainfall_mm": 0.0, "source": sensor.get("source", "simulated")}])
        if path == "/seasons":
            field_id = query.get("field_id", [None])[0]
            if field_id and _owned_item(fields, field_id, owner_id) is None:
                return self._send(404, {"detail": "talhão não encontrado"})
            return self._send(200, _visible_items(seasons, owner_id, field_id))
        if path in ("/operations", "/sensors", "/alert-rules", "/alerts"):
            field_id = query.get("field_id", [None])[0]
            if field_id and _owned_item(fields, field_id, owner_id) is None:
                return self._send(404, {"detail": "talhão não encontrado"})
            collection = {"/operations": operations, "/sensors": sensors, "/alert-rules": rules, "/alerts": alerts}[path]
            return self._send(200, _visible_items(collection, owner_id, field_id))
        analytics_match = re.fullmatch(r"/analytics/fields/([^/]+)/(series|weather|irrigation-response)", path)
        if analytics_match:
            field_id, metric = analytics_match.groups()
            if _owned_item(fields, field_id, owner_id) is None:
                return self._send(404, {"detail": "talhão não encontrado"})
            if metric == "series":
                return self._send(200, [{"bucket": NOW, "value": 38.4, "min": 31.0, "max": 44.2, "readings": 12}])
            if metric == "irrigation-response":
                response = []
                for operation in operations:
                    if _owner_id(operation) != owner_id or operation.get("field_id") != field_id or operation.get("type") != "irrigacao":
                        continue
                    operation_data = operation.get("details", {}).get("operation_data", {})
                    response.append(
                        {
                            "operation_id": operation["id"],
                            "date": operation.get("date", NOW),
                            "source": operation.get("source", "simulated"),
                            "reading_source": "simulated",
                            "water_depth_mm": operation_data.get("water_depth_mm"),
                            "duration_hours": operation_data.get("duration_hours"),
                            "method": operation_data.get("method"),
                            "window_hours": int(query.get("window_hours", [24])[0]),
                            "before": {"avg_soil_moisture": 31.2, "sensors": 1, "readings": 12},
                            "after": {"avg_soil_moisture": 34.6, "sensors": 1, "readings": 12},
                            "delta_percentage_points": 3.4,
                        }
                    )
                return self._send(200, response)
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
        summary_match = re.fullmatch(r"/analytics/farms/([^/]+)/summary", path)
        if summary_match:
            farm = _owned_item(farms, summary_match.group(1), owner_id)
            if farm is None:
                return self._send(404, {"detail": "fazenda não encontrada"})
            summary: dict[str, dict] = {}
            for field in fields:
                if _owner_id(field) != owner_id or field.get("farm_id") != farm["id"]:
                    continue
                entry = summary.setdefault(field.get("crop", ""), {"crop": field.get("crop", ""), "fields": 0, "area_ha": 0.0})
                entry["fields"] += 1
                entry["area_ha"] += float(field.get("area_ha", 0) or 0)
            return self._send(200, list(summary.values()))
        if path == "/analytics/production/ranking":
            ranking = [{"municipality": "Sorriso", "state": "MT", "year": 2023, "yield_kg_ha": 3750, "production_t": 2244375, "planted_area_ha": 598500}]
            selected_state = query.get("state", [None])[0]
            selected_year = query.get("year", [None])[0]
            return self._send(200, [row for row in ranking if (not selected_state or row["state"] == selected_state) and (not selected_year or str(row["year"]) == selected_year)])
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        body = self._body()
        if path == "/auth/login":
            email = str(body.get("username", body.get("email", ""))).strip().lower()
            user_id = accounts_by_email.get(email)
            account = accounts_by_id.get(user_id or "")
            if account is None or not self._check_password(account, body.get("password")):
                return self._send(401, {"detail": "credenciais inválidas"})
            token = f"mock-token-{user_id}"
            tokens[token] = user_id
            return self._send(200, {"access_token": token, "token_type": "bearer"})
        if path == "/auth/register":
            global next_user_number
            name = str(body.get("name", "")).strip()
            email = str(body.get("email", "")).strip().lower()
            password = body.get("password")
            if len(name) < 2 or "@" not in email or not isinstance(password, str) or len(password) < 8:
                return self._send(422, {"detail": "nome, e-mail ou senha inválidos"})
            if email in accounts_by_email:
                return self._send(409, {"detail": "e-mail já cadastrado"})
            with store_lock:
                user_id = f"mock-user-{next_user_number}"
                next_user_number += 1
                new_profile = {"id": user_id, "name": name, "email": email, "role": "produtor"}
                accounts_by_id[user_id] = {"profile": new_profile, "password": password}
                accounts_by_email[email] = user_id
            return self._send(201, _visible(new_profile))

        account = self._user()
        if account is None:
            return
        owner_id = account["profile"]["id"]
        collection = {"/farms": farms, "/fields": fields, "/seasons": seasons, "/operations": operations, "/sensors": sensors, "/alert-rules": rules}
        if path in collection:
            item = {**_request_fields(body), "id": _new_record_id(), "created_at": NOW, "_owner_id": owner_id}
            if path == "/farms":
                item.setdefault("location", {"type": "Point", "coordinates": [DEMO_LON, DEMO_LAT]})
                farms.append(item)
            elif path == "/fields":
                farm = _owned_item(farms, str(item.get("farm_id", "")), owner_id)
                if farm is None:
                    return self._send(404, {"detail": "fazenda não encontrada"})
                example_field = next((candidate for candidate in fields if _owner_id(candidate) == owner_id), None)
                item.setdefault("area_ha", 1)
                item.setdefault("boundary", example_field["boundary"] if example_field else {"type": "Polygon", "coordinates": [FIELD_RING]})
                item.setdefault("centroid", example_field["centroid"] if example_field else {"type": "Point", "coordinates": [DEMO_LON, DEMO_LAT]})
                item.setdefault("attributes", {})
                fields.append(item)
            elif path == "/seasons":
                field = _owned_item(fields, str(item.get("field_id", "")), owner_id)
                if field is None:
                    return self._send(404, {"detail": "talhão não encontrado"})
                if any(_owner_id(row) == owner_id and row.get("field_id") == field["id"] and row.get("label") == item.get("label") for row in seasons):
                    return self._send(409, {"detail": "safra já cadastrada neste talhão"})
                item["crop"] = field["crop"]
                seasons.append(item)
            elif path == "/operations":
                field = _owned_item(fields, str(item.get("field_id", "")), owner_id)
                if field is None:
                    return self._send(404, {"detail": "talhão não encontrado"})
                season_id = item.get("season_id")
                if season_id and not any(_owner_id(row) == owner_id and row.get("id") == season_id and row.get("field_id") == field["id"] for row in seasons):
                    return self._send(404, {"detail": "safra não encontrada neste talhão"})
                key = self.headers.get("Idempotency-Key", "").strip()
                if key:
                    if len(key) > 200:
                        return self._send(400, {"detail": "Idempotency-Key muito longa"})
                    fingerprint = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                    with store_lock:
                        existing = next((row for row in operations if _owner_id(row) == owner_id and row.get("_idempotency_key") == key), None)
                        if existing is not None:
                            if existing.get("_idempotency_fingerprint") != fingerprint:
                                return self._send(409, {"detail": "Idempotency-Key já usada com outro conteúdo"})
                            return self._send(200, _visible(existing))
                        item["_idempotency_key"] = key
                        item["_idempotency_fingerprint"] = fingerprint
                        operations.append(item)
                else:
                    operations.append(item)
            elif path == "/sensors":
                field = _owned_item(fields, str(item.get("field_id", "")), owner_id)
                if field is None:
                    return self._send(404, {"detail": "talhão não encontrado"})
                item.update({"field_id": field["id"], "farm_id": field["farm_id"], "active": item.get("active", True)})
                item.setdefault("location", field["centroid"])
                item.setdefault("source", "simulated")
                sensors.append(item)
            elif path == "/alert-rules":
                if _owned_item(fields, str(item.get("field_id", "")), owner_id) is None:
                    return self._send(404, {"detail": "talhão não encontrado"})
                rules.append(item)
            else:
                collection[path].append(item)
            return self._send(201, _visible(item))
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        body = self._body()
        if path == "/auth/me":
            account = self._user()
            if account is None:
                return
            if not self._check_password(account, body.get("current_password")):
                return self._send(401, {"detail": "senha atual inválida"})
            profile = account["profile"]
            name = body.get("name", profile["name"])
            email = body.get("email", profile["email"])
            if not isinstance(name, str) or len(name.strip()) < 2:
                return self._send(422, {"detail": "nome inválido"})
            if not isinstance(email, str) or "@" not in email:
                return self._send(422, {"detail": "e-mail inválido"})
            email = email.strip().lower()
            email_owner = accounts_by_email.get(email)
            if email_owner is not None and email_owner != profile["id"]:
                return self._send(409, {"detail": "e-mail já cadastrado"})
            new_password = body.get("new_password")
            if new_password is not None and (not isinstance(new_password, str) or len(new_password) < 8):
                return self._send(422, {"detail": "nova senha inválida"})
            accounts_by_email.pop(profile["email"], None)
            profile.update({"name": name.strip(), "email": email})
            accounts_by_email[email] = profile["id"]
            if new_password is not None:
                account["password"] = new_password
            return self._send(200, _visible(profile))

        account = self._user()
        if account is None:
            return
        owner_id = account["profile"]["id"]
        for prefix, items in (("/farms/", farms), ("/fields/", fields), ("/seasons/", seasons), ("/operations/", operations), ("/sensors/", sensors), ("/alert-rules/", rules)):
            if path.startswith(prefix):
                item_id = path[len(prefix):]
                item = _owned_item(items, item_id, owner_id)
                if item is None:
                    return self._send(404, {"detail": "not found"})
                updates = {
                    key: value for key, value in _request_fields(body).items()
                    if key not in {"id", "created_at"}
                }
                field_id = updates.get("field_id", item.get("field_id"))
                if prefix == "/fields/":
                    farm_id = updates.get("farm_id", item.get("farm_id"))
                    if _owned_item(farms, str(farm_id), owner_id) is None:
                        return self._send(404, {"detail": "fazenda não encontrada"})
                elif prefix == "/seasons/":
                    field = _owned_item(fields, str(field_id), owner_id)
                    if field is None:
                        return self._send(404, {"detail": "talhão não encontrado"})
                    updates["crop"] = field["crop"]
                elif prefix in ("/operations/", "/sensors/", "/alert-rules/"):
                    field = _owned_item(fields, str(field_id), owner_id)
                    if field is None:
                        return self._send(404, {"detail": "talhão não encontrado"})
                    if prefix == "/operations/":
                        season_id = updates.get("season_id", item.get("season_id"))
                        if season_id and not any(
                            _owner_id(row) == owner_id
                            and row.get("id") == season_id
                            and row.get("field_id") == field["id"]
                            for row in seasons
                        ):
                            return self._send(404, {"detail": "safra não encontrada neste talhão"})
                    if prefix == "/sensors/":
                        updates["farm_id"] = field["farm_id"]
                item.update(updates)
                return self._send(200, _visible(item))
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path.rstrip("/")
        if path == "/auth/me":
            account = self._user()
            if account is None:
                return
            if not self._check_password(account, self._body().get("current_password")):
                return self._send(401, {"detail": "senha atual inválida"})
            self._delete_account(account["profile"]["id"])
            self._send(204)
            return
        account = self._user()
        if account is None:
            return
        owner_id = account["profile"]["id"]
        if path.startswith("/farms/"):
            farm_id = path.rsplit("/", 1)[-1]
            if not self._delete_owned_farm(owner_id, farm_id):
                return self._send(404, {"detail": "not found"})
            return self._send(204)
        if path.startswith("/fields/"):
            field_id = path.rsplit("/", 1)[-1]
            field = _owned_item(fields, field_id, owner_id)
            if field is None:
                return self._send(404, {"detail": "not found"})
            fields.remove(field)
            self._delete_owned_field_data(owner_id, {field_id})
            return self._send(204)
        for prefix, items in (("/seasons/", seasons), ("/operations/", operations), ("/sensors/", sensors), ("/alert-rules/", rules)):
            if path.startswith(prefix):
                item_id = path[len(prefix):]
                item = _owned_item(items, item_id, owner_id)
                if item is None:
                    return self._send(404, {"detail": "not found"})
                items.remove(item)
                return self._send(204)
        return self._send(404, {"detail": f"mock endpoint not found: {path}"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
