.PHONY: setup up demo down reset seed api-seed workers-seed logs test test-setup import-inmet import-ibge rollup web-dev api-dev workers-dev

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

test-setup:
	test -x apps/api/.venv/bin/python || uv venv --python 3.12 apps/api/.venv
	apps/api/.venv/bin/python -c 'import sys; assert sys.version_info[:2] == (3, 12), "apps/api/.venv precisa usar Python 3.12"'
	uv pip install --python apps/api/.venv/bin/python --require-hashes -r apps/api/requirements-dev.lock
	test -x apps/workers/.venv/bin/python || uv venv --python 3.12 apps/workers/.venv
	apps/workers/.venv/bin/python -c 'import sys; assert sys.version_info[:2] == (3, 12), "apps/workers/.venv precisa usar Python 3.12"'
	uv pip install --python apps/workers/.venv/bin/python --require-hashes -r apps/workers/requirements-dev.lock

test: test-setup
	cd apps/api && .venv/bin/ruff check . && .venv/bin/pytest -q
	cd apps/workers && .venv/bin/ruff check . && .venv/bin/pytest -q

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
