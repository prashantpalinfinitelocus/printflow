# PrintFlow API — FastAPI + psd-tools rendering.
#
# The renderer reaches outside Python for three things, so they are installed
# here rather than assumed:
#   fonts        — the fallback faces the renderer looks for by absolute path
#                  when a format names no font of its own
#   ICC profiles — needed to separate to CMYK; without one the renderer falls
#                  back to RGB rather than writing an untagged CMYK TIFF
#   cups-client  — the `lp` / `lpstat` binaries used to dispatch jobs
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-dejavu-core \
        fonts-noto-core \
        # icc-profiles-free ships FOGRA *measurement data* (.ti3), not usable
        # profiles. Ghostscript carries the actual default_cmyk.icc.
        ghostscript \
        icc-profiles-free \
        cups-client \
        postgresql-client \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first so edits to app code do not invalidate the install layer.
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY tests ./tests

# data/ is bind-mounted from the host at runtime, so PSDs, fonts, the CSV inbox
# and rendered output stay on the laptop and survive the container.
ENV PRINTFLOW_DATA_DIR=/data \
    PRINTFLOW_INBOX_DIR=/data/inbox \
    PRINTFLOW_PSD_DIR=/data/psd \
    PRINTFLOW_OUTPUT_DIR=/data/output \
    PRINTFLOW_FONTS_DIR=/data/fonts

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
