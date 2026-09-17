export class HttpError extends Error {
  constructor(status, code, message, options = undefined) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export class UpstreamError extends HttpError {
  constructor(code, message, options = undefined) {
    super(502, code, message, options);
    this.name = "UpstreamError";
  }
}

export function asPublicError(error) {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: "The TARV1S lab service could not complete that request.",
      },
    },
  };
}
