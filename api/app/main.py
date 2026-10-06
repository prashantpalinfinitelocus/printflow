import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

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
    from .services.printing import list_printers, printing_available

    return {
        "status": "ok",
        "printing_available": printing_available(),
        "printers": [p.name for p in list_printers()],
        "tiff_colorspace": settings.tiff_colorspace,
    }


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
