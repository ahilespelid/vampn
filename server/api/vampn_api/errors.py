class ApiError(Exception):
    status = 400
    code = "error"

    def __init__(self, message="", **extra):
        super().__init__(message or self.code)
        self.message = message or self.code
        self.extra = extra


class Locked(ApiError):
    status = 429
    code = "locked"


class InvalidCode(ApiError):
    status = 401
    code = "invalid_code"


class Unauthorized(ApiError):
    status = 401
    code = "unauthorized"


class Forbidden(ApiError):
    status = 403
    code = "forbidden"


class NotFound(ApiError):
    status = 404
    code = "not_found"


class Conflict(ApiError):
    status = 409
    code = "conflict"


class BadRequest(ApiError):
    status = 400
    code = "bad_request"


class CommandFailed(ApiError):
    status = 502
    code = "command_failed"
