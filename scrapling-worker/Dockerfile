FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "scrapling[fetchers]==0.4.15" \
    "fastapi==0.116.1" \
    "uvicorn[standard]==0.35.0" \
    "psycopg[binary,pool]==3.2.10" \
    "httpx==0.28.1" \
    "pytest==8.4.1" \
    "pytest-asyncio==1.1.0"

# Scrapling fetchers/spiders require their browser + system dependencies.
RUN scrapling install

COPY . .
RUN pytest -q && python -m compileall -q app

EXPOSE 3001
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3001}"]
