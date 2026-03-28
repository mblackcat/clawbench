## 1. Python runner: log malformed JSON

- [ ] 1.1 Add `logger.warn` with raw line and error message in the catch block at `python-runner.service.ts:198`

## 2. Publisher: handle malformed manifest.json

- [ ] 2.1 Wrap `JSON.parse(manifestContent)` at `publisher.service.ts:138` in try-catch, returning `{ success: false, error }` on failure

## 3. Auth: validate Feishu token response fields

- [ ] 3.1 Add field validation guard before token casts at `auth.service.ts:159-162` (login path)
- [ ] 3.2 Add field validation guard before token casts at `auth.service.ts:286-290` (refresh path)

## 4. Verify

- [ ] 4.1 Run TypeScript type check (`npm run typecheck`) to confirm no type errors introduced
