import json
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
import logging

log = logging.getLogger("rahat")

async def custom_validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    with open("422_errors.txt", "a") as f:
        f.write(f"422 ERROR: {body.decode('utf-8')}\nERRORS: {exc.errors()}\n")
    log.error("VALIDATION ERROR. Body: %s", body)
    log.error("Errors: %s", exc.errors())
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": body.decode("utf-8")},
    )
