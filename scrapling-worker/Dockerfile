FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN pip install --no-cache-dir '.[dev]'

# Scrapling fetchers/spiders require their browser + system dependencies.
RUN scrapling install

# Keep the verification step explicit and observable in Railway build logs.
RUN python -m pytest -q --cache-clear \
  && python -m compileall -q app \
  && python -c "from app.spider import PdfDiscoverySpider; from app.dynamic_policy import needs_dynamic_fallback; print('scrapling-dynamic-verification-ok')"

EXPOSE 3001
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3001}"]
