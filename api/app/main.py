import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .config import settings
from .db import Base, engine
from .migrations import run_migrations
from .routers import auth, formats, orders, printing, stores, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("printflow")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings.ensure_dirs()
    Base.metadata.create_all(bind=engine)
    run_migrations()  # additive columns create_all() cannot add to existing tables
    log.info("PrintFlow API ready — data dir %s", settings.data_dir)
    yield


app = FastAPI(
    title="PrintFlow API",
    version="1.0.0",
    description="Store-scoped print order queue: CSV intake, PSD composition, TIFF/PDF output, CUPS dispatch.",
    lifespan=lifespan,
    root_path=settings.root_path,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["meta"])
def health() -> dict:
    """Liveness: the process is up. Public, so it says nothing about the system."""
    return {"status": "ok"}


@app.get("/health/ready", tags=["meta"])
def ready():
    """Readiness: the process is up and can reach its database. Public and minimal."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        log.exception("readiness check failed")
        return JSONResponse({"status": "unavailable", "database": "down"}, status_code=503)
    return {"status": "ok", "database": "ok"}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Tell browsers not to guess a response's type. Artifact downloads (TIFF, PDF,
    PNG) are served from here, so a sniffed type could turn a file into a page."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


app.include_router(auth.router)
app.include_router(stores.router)
app.include_router(users.router)
app.include_router(formats.router)
app.include_router(orders.router)
app.include_router(printing.router)
