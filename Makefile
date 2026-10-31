.PHONY: setup up demo down reset seed api-seed workers-seed logs test import-inmet import-ibge rollup web-dev api-dev workers-dev

setup:
	cp -n .env.example .env || true

up:
	docker compose up -d --build

demo:
	docker compose up -d --build mongo api web alerts rollup
	docker compose run --rm api python -m app.seed --fields 3 --sensors-per-field 2
	docker compose run --rm --no-deps simulator python -m workers.simulator --backfill-days 7 --step-minutes 5
	docker compose up -d simulator
	docker compose run --rm --no-deps simulator python -m workers.inmet --file /imports/inmet-sp-a763-2024.zip --year 2024 --states SP
	docker compose run --rm --no-deps simulator python -m workers.ibge --file /imports/pam-sp-2023.csv --year 2023 --states SP --crops soja milho cana
	docker compose run --rm --no-deps simulator python -m workers.rollup --days 30

down:
	docker compose down

reset:
	docker compose down -v

seed:
	docker compose run --rm api python -m app.seed --fields 3 --sensors-per-field 2

api-seed:
	docker compose -p agropulse-api -f docker-compose.api.yml run --rm api python -m app.seed --fields 3 --sensors-per-field 2

workers-seed:
	docker compose -p agropulse-workers -f docker-compose.workers.yml run --rm --no-deps demo-seed

logs:
	docker compose logs -f api simulator alerts

test:
	cd apps/api && pytest -q
	cd apps/workers && pytest -q

web-dev:
	docker compose -p agropulse-web -f docker-compose.web.yml up --build

api-dev:
	docker compose -p agropulse-api -f docker-compose.api.yml up --build

workers-dev:
	docker compose -p agropulse-workers -f docker-compose.workers.yml up --build

import-inmet:
	docker compose run --rm simulator python -m workers.inmet $(INMET_ARGS)

import-ibge:
	docker compose run --rm simulator python -m workers.ibge $(IBGE_ARGS)

rollup:
	docker compose run --rm simulator python -m workers.rollup --days 30
