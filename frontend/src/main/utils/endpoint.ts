/**
 * Endpoint normalization for AI provider base URLs.
 *
 * Users paste relay/gateway endpoints in many shapes (bare origin, with /v1,
 * with a full /chat/completions path). Each SDK has different expectations:
 * - OpenAI SDK: baseURL must already contain the version prefix (".../v1"),
 *   it appends "/chat/completions" directly.
 * - Anthropic SDK: baseURL must NOT contain "/v1", it appends "/v1/messages".
 *
 * Getting this wrong against new-api style gateways is especially confusing:
 * unknown paths fall through to the dashboard SPA which answers HTTP 200 with
 * HTML, so the SDK fails with a cryptic parse error instead of a 404.
 */

function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * Normalize a base URL for OpenAI / OpenAI-compatible SDK clients.
 *
 * - Strips a pasted full request path ("/chat/completions", "/completions",
 *   "/responses", "/models")
 * - Appends "/v1" when the URL has no path at all (bare origin), matching the
 *   OpenAI convention. Custom prefixes like "/api/v3" or "/team/v1" are kept.
 * - Returns undefined for empty input so the SDK falls back to its default.
 */
export function normalizeOpenAIBaseURL(endpoint: string | undefined): string | undefined {
  if (!endpoint || !endpoint.trim()) return undefined
  let url = stripTrailingSlashes(endpoint)
  url = url.replace(/\/(chat\/completions|completions|responses|models)$/, '')
  url = stripTrailingSlashes(url)
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '' || parsed.pathname === '/') {
      url = `${url}/v1`
    }
  } catch {
    // Not an absolute URL — leave as-is and let the SDK surface the error
  }
  return url
}

/**
 * Normalize a base URL for the Anthropic SDK.
 *
 * The SDK appends "/v1/messages" itself, so a trailing "/v1" (or a pasted
 * "/v1/messages" path) must be stripped or requests hit "/v1/v1/messages".
 * Returns undefined for empty input so the SDK falls back to its default.
 */
export function normalizeAnthropicBaseURL(endpoint: string | undefined): string | undefined {
  if (!endpoint || !endpoint.trim()) return undefined
  let url = stripTrailingSlashes(endpoint)
  url = url.replace(/\/v1\/messages$/, '').replace(/\/messages$/, '')
  url = stripTrailingSlashes(url)
  url = url.replace(/\/v1$/, '')
  return stripTrailingSlashes(url)
}
