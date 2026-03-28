## Why

Three main-process services have gaps in error handling that make debugging harder and can cause silent failures:
- `python-runner.service.ts` silently swallows JSON parse errors, making it impossible to diagnose malformed sub-app output
- `publisher.service.ts` crashes on malformed `manifest.json` instead of returning a clean error
- `auth.service.ts` blindly casts Feishu API response fields without checking they exist, risking silent `undefined` propagation

## What Changes

- Add warning log to the JSON parse catch block in the Python runner
- Wrap the bare `JSON.parse` in the publisher with error handling that matches the existing pattern
- Validate required fields from the Feishu token API before casting, at both call sites (login and refresh)

## Capabilities

### New Capabilities
- `service-error-hardening`: Improved error handling and validation across main-process services (python-runner, publisher, auth)

### Modified Capabilities
<!-- No existing specs are changing at the requirement level -->

## Impact

- `src/main/services/python-runner.service.ts`: Add `logger.warn` in catch block
- `src/main/services/publisher.service.ts`: Wrap `JSON.parse` in try-catch
- `src/main/services/auth.service.ts`: Add field validation at token exchange (~line 159) and token refresh (~line 286)
