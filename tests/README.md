# Browser acceptance for UI v2

`acceptance.py` provides real-browser acceptance for an exact source candidate.
**Use the report from each actual run as evidence for its tested commit.**
Static syntax review does not constitute browser acceptance.

The script requires Python 3.9 or later, an existing installation of async
Playwright, and the exact path to an already approved Chrome/Chromium executable.
It does not install dependencies, start a web server, discover substitute
browsers, use a personal browser profile, or mock requests/workers. Browser
execution on the Mac remains subject to the existing host confirmation.

These tests are repository tooling and must not be included in the deployed
static-file allowlist.

## Invocation

The caller must first make the exact candidate available at an existing project
URL. For a local server, preserve the real Pages subpath, for example
`http://127.0.0.1:8765/alfred-chess-demo/`. The live HTTPS project URL is also
supported. The trailing slash is required.

Example after the browser run has been authorized:

```sh
/usr/bin/python3 -B tests/acceptance.py \
  --base-url 'http://127.0.0.1:8765/alfred-chess-demo/' \
  --browser '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  --evidence-dir '/absolute/path/to/new-evidence-directory'
```

The outer driver must capture raw stdout and stderr separately, record the real
process exit status immediately, and propagate a nonzero exit. Do not generate a
PASS report from intermediate progress messages. Acceptance requires all of:

- Process exit status `0`.
- `report.json` has `status: "PASS"` and `diagnostic_count: 0`.
- `diagnostics.json` has an empty `diagnostics` array.
- The final stdout line is exactly `PASS Alfred Chess UI v2 acceptance`.

The body of the suite has a 150-second timeout. Context/browser cleanup is
attempted in `finally` with five-second bounds per operation. Existing evidence
files are never overwritten. The outer driver may create its stdout/stderr files
in the evidence directory before invoking the test.

## Coverage

The main fresh browser context loads the actual cm-chessboard modules and SVG
piece/marker assets, actual Esca WASM, and actual Stockfish JS/WASM. It verifies
one main element, heading, board, and cm-chessboard SVG; 64 squares; the twelve
sprite definitions; and rendered piece count against the displayed FEN.

It plays `e2e4` by clicking and `g1f3` by a real mouse drag, waiting for a real
Black reply after each. It checks reload persistence, flips the actual board in
both directions without changing the game, rejects the illegal knight move `f3f5`,
opens an observer tab and attempts a forbidden move, then closes the owner.
After automatic ownership transfer it plays `b1c3` through the Russian keyboard
move form and requires another real Black reply.

Input waits use the board's public DOM `data-input-enabled` state because the
status text can announce a White turn before position animation finishes.
Sprite definitions and network quiescence are awaited before closing pages, so
unfinished asset loads are not intentionally aborted.

The illegal-move check asserts the exact expected inline validation message
`На эту клетку сейчас нельзя пойти.` and unchanged game state. It runs after
the flip checks; the owner page then stays untouched until it closes. This
expected user feedback is recorded, while browser diagnostics remain strict.

The layout checks cover desktop 1400×1000, tablet 768×1024, and mobile 390×844,
with DPR 1. Four PNGs use **`full_page=False`**: desktop, tablet top, tablet
scrolled by up to 650 px, and mobile top. The tablet images overlap. JSON records
actual scrolling, element geometry, horizontal overflow checks, and PNG hashes.
If the tablet page fits entirely in the viewport, the second image records that
scrolling was unnecessary. The images still need human visual review; DOM checks
alone cannot establish their visual quality. No stitched full-page screenshot
is used.

## Promotion fixture

A second fresh context seeds only this valid persisted game history before the
application opens:

```json
{"schema":1,"revision":8,"moves":["a2a4","h7h5","a4a5","h5h4","a5a6","h4h3","a6b7","h3g2"],"skill":5,"finish":null}
```

The fixture was independently replayed through the actual Esca WASM during
preparation. Expected FEN:

```text
rnbqkbnr/pPppppp1/8/8/8/8/1PPPPPpP/RNBQKBNR w KQkq - 0 5
```

Esca verified all four `b7a8{n,b,r,q}` promotions as legal. The application must
restore the history through its normal production validation; the test does not
inject a FEN, replace the rules engine, or expose private application functions.
The test opens the promotion dialog, checks that FEN/history/persisted state stay
unchanged while waiting, cancels without committing, opens it again, selects
`Конь`, and requires `b7a8n` plus a real Black reply. The knight must remain on a8.

## Diagnostics and limits

All console errors and warnings, page errors, failed requests, and HTTP responses
with status 400 or above are recorded without exclusions. Requests outside the
project URL fail acceptance. Required engine/library asset responses must have
HTTP 200. Diagnostics are checked after context/browser cleanup, and a final
PASS is emitted only after all assertions and evidence writes succeed.

The test observes normal DOM, pointer/keyboard-form input, public FEN, displayed
history, and the existing persisted game format. It adds no product test API.
It does not establish physical tablet behavior, native BFCache restoration,
private MCP behavior, deployment identity, or a complete 51-file live hash audit.
Those remain separate checks.
