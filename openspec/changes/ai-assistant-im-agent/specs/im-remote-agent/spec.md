# Capability: im-remote-agent

## Requirements

### Requirement: Remote IM control switch
The system SHALL provide a `remoteEnabled` flag on Feishu IM configuration (default false for new configs). Soft migration: if Feishu credentials already exist and auto-connect was enabled, `remoteEnabled` MUST become true once so existing users keep access.

#### Scenario: New user has no top-bar entry
- **WHEN** remoteEnabled is false
- **THEN** the main window top bar does not show the Feishu IM control entry

#### Scenario: Enable shows entry
- **WHEN** the user enables remote IM control in settings or the IM modal
- **THEN** the top bar shows the Feishu IM entry

### Requirement: IM model selection
When remote IM is configured, the user MUST be able to select a fixed model (provider config + model id) used for IM agent conversations. If unset, the system SHALL fall back to the last selected local chat model.

#### Scenario: Fixed IM model used
- **WHEN** IM model is set and the user messages the Feishu bot with agent chat
- **THEN** completions use the configured IM model, not an arbitrary first model

### Requirement: Agent parity with local AI Chat
When remote IM is enabled and the assistant master switch is on, Feishu agent conversations SHALL use the same persona, harness, and memory injection as local AI Chat, and MAY invoke the same internal module tools. When the assistant master switch is off, IM agent chat uses the minimal system prompt without memory updates.

#### Scenario: Tool-capable IM reply
- **WHEN** remote IM is connected and the user asks in natural language to list installed apps
- **THEN** the agent may call workbench list tools and return results in the Feishu chat

### Requirement: Coding remains a sub-capability
Existing remote AI Coding slash commands, session cards, and multi-turn card stdin forwarding SHALL remain available and MUST NOT be broken by agent chat routing.

#### Scenario: Active coding session still receives plain text
- **WHEN** a coding session is active for the chat
- **THEN** plain text is forwarded to the coding session (existing behavior) rather than opening a new agent turn
- **AND** agent chat can still be invoked via `/chat` if needed

### Requirement: Conversation history and session boundaries
IM agent turns SHALL be persisted as conversations with source `im`. Sessions auto-close after 1 hour of silence or when the user sends `/new` (without a tool argument). The system SHOULD enforce a max turn count per session. Users MUST be able to view IM conversation history in the desktop client after returning.

#### Scenario: Idle timeout
- **WHEN** more than 1 hour passes since the last agent activity in a Feishu chat
- **AND** the user sends a new agent message
- **THEN** a new conversation is created and the previous one is closed with reason idle

#### Scenario: Explicit new conversation
- **WHEN** the user sends `/new` with no tool argument
- **THEN** the active agent conversation is closed and the next message starts a new conversation

#### Scenario: History visible in client
- **WHEN** the user opens AI Chat after IM conversations occurred
- **THEN** IM conversations appear in the conversation list with an IM source indicator
