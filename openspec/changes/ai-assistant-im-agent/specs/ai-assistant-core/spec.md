# Capability: ai-assistant-core

## Requirements

### Requirement: Assistant master switch
The system SHALL provide a global `assistantEnabled` setting defaulting to true. When disabled, the system MUST NOT update long-term memory files and MUST build the system prompt without soul, memory, user profile, harness, or stats injection (minimal identity prompt only).

#### Scenario: Default enabled
- **WHEN** a new install has no stored value
- **THEN** `assistantEnabled` is true

#### Scenario: Disabled skips memory writes
- **WHEN** `assistantEnabled` is false
- **THEN** the memory self-update job does not write `memory.md`
- **AND** conversation feedback does not mutate `memory.md`

#### Scenario: Disabled uses minimal system prompt
- **WHEN** `assistantEnabled` is false and the user sends a chat message
- **THEN** the system prompt does not include soul.md, memory.md, user.md, tools.md harness, or stats snippets

### Requirement: Role-based persona initialization
The system SHALL initialize agent persona (`soul.md`) from a template matching the user's setup role (general, design, tech, art). Users MUST be able to switch templates or edit free-form text. Restore default MUST use the stored setup role template.

#### Scenario: Setup completes with tech role
- **WHEN** the user finishes setup with role `tech` and soul is empty/default
- **THEN** soul.md is written from the tech persona template including capabilities and boundaries

#### Scenario: User applies design template
- **WHEN** the user selects the design template in settings and confirms
- **THEN** soul.md content is replaced with the design template

### Requirement: Harness module descriptions
When the assistant is enabled, the system prompt SHALL include a harness section describing how the agent uses Workbench apps, AI Terminal/DB, and AI Coding, derived from tools.md and/or built-in defaults.

#### Scenario: Enabled chat includes harness
- **WHEN** assistant is enabled and tools.md has content
- **THEN** the system prompt contains the harness/tools capability section

### Requirement: Module action tools
The internal tool registry SHALL expose tools for: listing/running installed apps, searching/installing marketplace apps, terminal command execution, database query and gated updates, and creating coding sessions with an initial prompt.

#### Scenario: Run installed app via tool
- **WHEN** the agent calls `run_workbench_app` with a valid app id and params
- **THEN** the Python sub-app is executed and the tool result includes success/failure summary

#### Scenario: Unsafe SQL rejected
- **WHEN** the agent calls a database write tool with DROP/TRUNCATE without explicit allow
- **THEN** the tool returns an error and does not execute

### Requirement: Memory self-update
While the desktop client is online and assistant is enabled, the system SHALL periodically summarize recent AI conversations across modules into `memory.md`.

#### Scenario: Periodic update while online
- **WHEN** assistant is enabled, client is running, and new conversations exist since last run
- **THEN** memory.md is updated with a condensed summary within the configured interval
