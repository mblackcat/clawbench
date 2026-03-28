## ADDED Requirements

### Requirement: Log malformed sub-app JSON output

When the Python runner receives a stdout line that fails JSON parsing, it must log the parse error before falling back to plain-text treatment.

#### Scenario: Sub-app emits invalid JSON

- **WHEN** a sub-app stdout line fails `JSON.parse`
- **THEN** a warning is logged containing the raw line content and the parse error message
- **AND** the line is still forwarded as plain-text output (existing behavior preserved)

### Requirement: Handle malformed manifest in publisher

When the publisher reads a `manifest.json` that is not valid JSON, it must return a structured error instead of crashing.

#### Scenario: manifest.json contains invalid JSON

- **WHEN** `JSON.parse` fails on `manifest.json` content during publishing
- **THEN** the function returns `{ success: false, error: "..." }` with a message identifying the parse failure
- **AND** no archive file is created

### Requirement: Validate Feishu token response shape

Before using token data from the Feishu API, required fields must be validated.

#### Scenario: Token exchange response missing required fields

- **WHEN** the Feishu token API returns data missing `access_token`, `refresh_token`, or `expires_in`
- **THEN** an error is thrown with a message identifying which field is missing
- **AND** no tokens are saved

#### Scenario: Token refresh response missing required fields

- **WHEN** the Feishu token refresh API returns data missing `access_token`, `refresh_token`, or `expires_in`
- **THEN** the refresh function returns `false`
- **AND** an error is logged identifying which field is missing
