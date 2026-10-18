from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import get_settings
from app.api import auth, work_items, approvals, dashboard, collaboration

app = FastAPI(title="Relay API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().frontend_origin],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)
app.include_router(auth.router, prefix="/api/v1")
app.include_router(work_items.router, prefix="/api/v1")
app.include_router(collaboration.router, prefix="/api/v1")
app.include_router(approvals.router, prefix="/api/v1")
app.include_router(dashboard.router, prefix="/api/v1")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.exception_handler(RequestValidationError)
def validation_error(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "detail": {
                "code": "validation_error",
                "message": "Request validation failed",
                "errors": [
                    {"location": list(item["loc"]), "type": item["type"]}
                    for item in exc.errors()
                ],
            }
        },
    )


@app.exception_handler(HTTPException)
def http_error(request: Request, exc: HTTPException):
    detail = (
        exc.detail
        if isinstance(exc.detail, dict)
        else {"code": "http_error", "message": str(exc.detail)}
    )
    return JSONResponse(
        status_code=exc.status_code, content={"detail": detail}, headers=exc.headers
    )
