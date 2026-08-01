FROM python:3.12-slim AS builder

WORKDIR /build
COPY pyproject.toml README.md ./
COPY packages/nexusos-python packages/nexusos-python
RUN pip wheel --no-cache-dir --wheel-dir /wheels ".[api]"

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN groupadd --system --gid 10001 nexusos \
    && useradd --system --uid 10001 --gid nexusos --home-dir /app nexusos
WORKDIR /app
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir /wheels/* \
    && rm -rf /wheels
COPY agents agents
COPY skills skills
USER nexusos
EXPOSE 8000
CMD ["uvicorn", "nexusos.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
