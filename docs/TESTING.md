# Slim validation

Required local gates:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Required integration environment:

- explicit local/CI test database name;
- `NODE_ENV=test` and `ALLOW_TEST_DATABASE_RESET=true` for reset;
- Fake AI provider only in test;
- a fake or isolated RAGFlow API, never customer datasets.

Security acceptance must cover unauthenticated access, project listing scope, project CRUD, member add/change/remove, Dataset mapping, upload/parse/delete/failure, citations, cross-project authorized scope, URL/body tampering, and the A/B canary isolation case. Live RAGFlow API acceptance is documented separately and cannot be called passed until the resource gate and service key are available.
