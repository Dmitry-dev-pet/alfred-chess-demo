# Connecting a chess coach

**Design proposal · 2026-11-28. Not implemented.** The published demo has no
language-model connection, active coach endpoint, or configured provider login.
This proposal does not authorize deployment, registration, inference, or spending.

## Intended connection

The GitHub Pages frontend would call an authenticated HTTPS bridge on the owner's
Mac. That bridge would validate a chess-coaching request, call an official model
provider, and stream an explanation back. The tunnel provides network reachability;
the bridge supplies application authentication and the restricted request contract.
The Mac must remain available.

There is also a distinct **ChatGPT-operated game** option: the browser and an MCP
adapter share one authenticated game service, and ChatGPT reads the position and
submits an authorized move through MCP during a user-initiated chat turn. That
does not require embedding a model client in the page. It does require replacing
or explicitly migrating this demo's browser-local authority, with revision and
seat checks. An MCP tunnel lets ChatGPT call tools; it does not let the page send
messages into an existing ChatGPT conversation or start autonomous turns. The
in-page coach design below is a separate integration choice.

Initially, the coach would explain positions only when the player explicitly opens
coaching or post-game analysis. It would not move pieces, start games, change
strength, or expose unrestricted analysis during ordinary opponent play. The
existing browser game remains the authority for this standalone demo. Connecting
a separate shared-game service would require another reviewed state contract.

## Position and conversation contract

Each request would include a unique request ID, game ID, current revision, initial
position, variant, ordered move history, current FEN, selected Esca facts, and the
player's question. FEN alone is insufficient for history-dependent rules. Browser
input and fact labels remain untrusted; the bridge must validate their structure
and consistency before using them as grounding.

Each reply would carry the same game ID, revision, request ID, and a digest of the
position input. The frontend must reject or visibly mark a stale answer if the
game changes during generation. Explanations must distinguish computed facts from
the model's interpretation. Model text is displayed as text or restricted Markdown,
never executed as HTML, JavaScript, or a game action.

Conversation history belongs to this application and is scoped to the authenticated
session and game. Signing in does not import this project's ChatGPT conversations,
ChatGPT memory, or other account context. The bridge sends only the history needed
for the current request and applies a documented retention limit.

## Access and resource boundaries

Anonymous inference must be denied. A public board does not make the owner's
provider allowance available to visitors. The browser receives only an application
session; provider access, refresh, and identity tokens stay in protected runtime
storage on the Mac, outside browser storage, URLs, repository files, and logs.

CORS must allow the exact deployed origin, `https://dmitry-dev-pet.github.io`,
without a repository path or wildcard. Other Pages projects under that hostname
share the origin, so CORS is not authorization. Requests also require a valid
application session, session ownership checks, and appropriate CSRF protection.

The bridge must bound request bytes, history length, retained context, response
bytes, and wall-clock duration. Allow one in-flight request per session; cancel
obsolete work and propagate cancellation upstream. Use request IDs to reconcile
interrupted requests before retrying. Quota errors must produce an explicit error,
without changing providers or issuing duplicate requests automatically.

Expose only the chess-coach operation. Do not accept arbitrary destinations,
provider configuration, filesystem paths, shell commands, or tool definitions.
The model receives no filesystem, shell, browser-control, or general execution
tools through this endpoint.

## Official provider options to verify

OpenAI documents **Sign in with ChatGPT** with optional ChatGPT plan usage for
eligible accounts and open-source or locally hosted applications. This requires
the application's own registration, user consent, and inference scopes; ordinary
identity sign-in is insufficient. The documented local flow uses a loopback OAuth
callback on the machine completing sign-in.

Eligibility for this specific hybrid of a public Pages frontend and a privately
accessed Mac bridge is **not established**. The documentation directs paid or
remotely hosted applications to a separate interest process, and website sign-in
has partner-trial restrictions. Verify the applicable client category and actual
account entitlement before implementing login or presenting it as available.
Publishing a repository or using an MIT-licensed board does not establish the
application's own open-source license or eligibility; verify that separately.

For the documented plan-usage preview, use the public Responses API, not ChatGPT
`backend-api` endpoints or browser-session cookies. HTTP inference requires
`store: false` and `stream: true`; send required context in the input. Persistent
conversation lookup through `previous_response_id` is unavailable on this HTTP
route. Several standard parameters, including `max_output_tokens`, and hosted
MCP/connectors are unsupported. Enforce local bounds without inventing unsupported
provider parameters. A stream is successful only after `response.completed`.

Codex app-server is an optional integration layer for application-owned threads
and streaming. It is not necessary for a simple text coach, and must not expose
an existing development session or unrestricted agent capabilities. A conventional
API-key route is another option only after separate authorization of its provider,
credentials, and usage costs; it is never an automatic paid fallback.

## References and next evidence

Before activation, review the adapter, verify anonymous and stale-request rejection,
complete the authorized login, and observe one bounded real coaching response.
Documentation, a model catalog, and an open tunnel alone do not prove inference.

- [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart)
- [Open-source/local application scope](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Credential storage and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations.md)
- [Website integration limits](https://developers.openai.com/siwc/website)
