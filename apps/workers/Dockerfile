FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv

COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY workers ./workers

RUN useradd --create-home appuser
USER appuser

CMD ["python", "-m", "workers.simulator", "--live"]
