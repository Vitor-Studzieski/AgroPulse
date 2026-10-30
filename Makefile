.PHONY: setup up down reset seed logs test import-inmet rollup

setup:
	cp -n .env.example .env || true

up:
	docker compose up -d --build

down:
	docker compose down

reset:
	docker compose down -v

seed:
	docker compose run --rm api python -m app.seed --fields 3 --sensors-per-field 2

logs:
	docker compose logs -f api simulator alerts

test:
	cd apps/api && pytest -q
	cd apps/workers && pytest -q

import-inmet:
	docker compose run --rm simulator python -m workers.inmet --year 2024 --states MT SP GO

rollup:
	docker compose run --rm simulator python -m workers.rollup --days 30
