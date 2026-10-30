function notFound(req, res) {
  const message = `No route for ${req.method} ${req.originalUrl.split('?')[0]}`;
  res.status(404).json({ error: message, code: 'NOT_FOUND', message });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return res.end();
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON.', code: 'INVALID_JSON', message: 'Request body is not valid JSON.' });
  }
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => e.message);
    const msg = errors.join('; ');
    return res.status(400).json({ error: msg, code: 'VALIDATION_ERROR', message: msg, errors });
  }
  if (err.name === 'CastError') {
    const msg = `Invalid value for ${err.path}`;
    return res.status(400).json({ error: msg, code: 'INVALID_INPUT', message: msg });
  }
  if (err.code === 11000) {
    const msg = `Duplicate value: ${Object.keys(err.keyValue || {}).join(', ')}`;
    return res.status(409).json({ error: msg, code: 'DUPLICATE_KEY', message: msg });
  }

  const status = err.status || 500;
  if (status >= 500 && status !== 503) console.error(err);

  const code = err.code || (status === 503 ? 'AI_OFFLINE' : (status === 404 ? 'NOT_FOUND' : (status === 401 ? 'UNAUTHORIZED' : (status === 403 ? 'FORBIDDEN' : 'SERVER_ERROR'))));
  const rawMsg = err.message || 'An unexpected error occurred.';
  const message = status === 503 ? rawMsg : (status >= 500 ? `Server error: ${rawMsg}` : rawMsg);

  res.status(status).json({
    error: message,
    code,
    message,
    ...(err.extra || {})
  });
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFound, errorHandler, asyncHandler };
