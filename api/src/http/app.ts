import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';

const validRequestId = /^[a-zA-Z0-9._:-]{1,128}$/;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use((request: Request, response: Response, next) => {
    const incoming = request.header('x-request-id');
    const requestId = incoming && validRequestId.test(incoming) ? incoming : randomUUID();
    response.setHeader('X-Request-Id', requestId);
    response.locals.requestId = requestId;
    next();
  });
  app.get('/health', (_request, response) => response.json({ status: 'ok', requestId: response.locals.requestId as string }));
  app.use((_request, response) => {
    response.status(404).type('application/problem+json').json({
      type: 'about:blank', title: 'Not Found', status: 404, instance: response.req.originalUrl,
      requestId: response.locals.requestId as string
    });
  });
  const errorHandler: ErrorRequestHandler = (_error, _request, response, next) => {
    void next;
    response.status(500).type('application/problem+json').json({
      type: 'about:blank', title: 'Internal Server Error', status: 500,
      instance: response.req.originalUrl, requestId: response.locals.requestId as string
    });
  };
  app.use(errorHandler);
  return app;
}
