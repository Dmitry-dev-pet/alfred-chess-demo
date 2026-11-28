#!/usr/bin/env python3
"""Real-browser acceptance for Alfred Chess UI v2; Python 3.9+.

This script never starts a server, installs a browser, mocks network traffic,
or uses a saved browser profile. Run only with an explicitly approved browser.
The caller owns raw stdout/stderr capture and process exit-status propagation.
"""

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import sys
import time
import traceback
from datetime import datetime, timezone
from urllib.parse import urlparse

from playwright.async_api import async_playwright


STORAGE_KEY = "alfred-chess-demo.v1"
SUITE_TIMEOUT_SECONDS = 150
TURN_TIMEOUT_MS = 25000
PIECES = ("wp", "wn", "wb", "wr", "wq", "wk",
          "bp", "bn", "bb", "br", "bq", "bk")
PROMOTION_MOVES = ["a2a4", "h7h5", "a4a5", "h5h4",
                   "a5a6", "h4h3", "a6b7", "h3g2"]
PROMOTION_FEN = "rnbqkbnr/pPppppp1/8/8/8/8/1PPPPPpP/RNBQKBNR w KQkq - 0 5"
PROMOTION_STATE = {"schema": 1, "revision": 8, "moves": PROMOTION_MOVES,
                   "skill": 5, "finish": None}
HISTORY_FIXTURES = (
    {"name": "actual_castling_history_label", "moves": [
        "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1h1", "f8c5"],
     "ply": 7, "label": "O–O", "pieces": {"g1": "K", "f1": "R"}},
    {"name": "ordinary_rook_history_label", "moves": [
        "e2e4", "a7a6", "g1f3", "a6a5", "f1c4", "b7b6",
        "e1e2", "b6b5", "h1e1", "c7c6", "e1h1", "c6c5"],
     "ply": 11, "label": "e1–h1", "pieces": {"e2": "K", "h1": "R"}},
)
REQUIRED_ASSET_SUFFIXES = (
    "/app.mjs", "/chess.mjs", "/engine/esca.wasm.gz",
    "/engine/stockfish-19-lite-single.js",
    "/engine/stockfish-19-lite-single.wasm",
    "/src/Chessboard.js", "/src/extensions/markers/Markers.js",
    "/assets/chessboard.css", "/assets/extensions/markers/markers.css",
    "/assets/pieces/standard.svg", "/assets/extensions/markers/markers.svg",
)


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def normalize_base_url(value):
    parsed = urlparse(value)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or
            not parsed.path.endswith("/") or parsed.query or parsed.fragment or
            parsed.username or parsed.password):
        raise ValueError("--base-url must be an HTTP(S) URL with a trailing slash and no credentials/query/fragment")
    if parsed.port == {"http": 80, "https": 443}[parsed.scheme]:
        return parsed._replace(netloc=parsed.netloc.rsplit(":", 1)[0]).geturl()
    return value


def piece_at(fen, square):
    """Read a square from public FEN; this is not a chess rules implementation."""
    rank = fen.split()[0].split("/")[8 - int(square[1])]
    expanded = "".join("." * int(c) if c.isdigit() else c for c in rank)
    return expanded[ord(square[0]) - ord("a")]


class Evidence:
    def __init__(self, args):
        self.args = args
        self.started = time.monotonic()
        self.contexts = []
        self.current_page = None
        self.diagnostics = []
        self.requests = []
        self.responses = []
        self.checks = []
        self.screenshots = []
        self.report = {
            "status": "RUNNING", "started_utc": utc_now(),
            "base_url": args.base_url, "browser_executable": str(args.browser),
            "python": sys.version.split()[0],
            "playwright": importlib.metadata.version("playwright"),
            "harness_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "suite_timeout_seconds": SUITE_TIMEOUT_SECONDS,
            "network_mocking": False, "fresh_browser_contexts": True,
            "promotion_fixture": {"state": PROMOTION_STATE, "fen": PROMOTION_FEN},
            "checks": self.checks, "screenshots": self.screenshots,
            "limitations": [
                "Desktop browser viewports do not establish physical tablet acceptance.",
                "This suite does not establish native BFCache restoration.",
            ],
        }

    def diagnostic(self, kind, label, **details):
        self.diagnostics.append({"kind": kind, "context": label, **details})

    def attach_page(self, page, label):
        page.on("pageerror", lambda error: self.diagnostic(
            "pageerror", label, message=str(error),
            stack=getattr(error, "stack", None)))

    async def context(self, browser, label):
        context = await browser.new_context(
            viewport={"width": 1400, "height": 1000}, device_scale_factor=1)
        context.set_default_timeout(8000)
        context.set_default_navigation_timeout(20000)
        self.contexts.append((label, context))
        context.on("page", lambda page: self.attach_page(page, label))

        def console(message):
            if message.type in ("error", "warning"):
                self.diagnostic("console", label, level=message.type,
                                message=message.text, location=message.location)

        def response(item):
            row = {"context": label, "url": item.url, "status": item.status}
            self.responses.append(row)
            if item.status >= 400:
                self.diagnostic("http", label, url=item.url, status=item.status)

        context.on("console", console)
        context.on("response", response)
        context.on("request", lambda request: self.requests.append({
            "context": label, "url": request.url, "method": request.method,
            "resource_type": request.resource_type}))
        context.on("requestfailed", lambda request: self.diagnostic(
            "requestfailed", label, url=request.url, failure=request.failure))
        return context

    def completed(self, name, **details):
        row = {"name": name, "completed": True, **details}
        self.checks.append(row)
        print(json.dumps({"check": row}, ensure_ascii=False), flush=True)

    async def screenshot(self, page, name):
        path = self.args.evidence_dir / name
        await page.screenshot(path=str(path), full_page=False, timeout=10000)
        row = {"file": name, "full_page": False,
               "viewport": page.viewport_size,
               "scroll_y": await page.evaluate("window.scrollY"),
               "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        self.screenshots.append(row)
        return row

    def verify_assets(self, label):
        rows = [r for r in self.responses if r["context"] == label]
        for suffix in REQUIRED_ASSET_SUFFIXES:
            require(any(urlparse(r["url"]).path.endswith(suffix)
                        and r["status"] == 200 for r in rows),
                    "Missing actual HTTP 200 asset in %s: %s" % (label, suffix))
        self.completed("actual_local_assets_" + label,
                       required_suffixes=list(REQUIRED_ASSET_SUFFIXES))


async def wait_ready(page, plies, owner=True):
    await page.wait_for_function(
        """({plies, owner, key}) => {
            const board = document.getElementById('board');
            const status = document.getElementById('status');
            const saved = JSON.parse(localStorage.getItem(key) || 'null');
            return board && status &&
                document.querySelectorAll('#history li').length === plies &&
                (!plies || (saved && saved.moves.length === plies)) &&
                board.dataset.inputEnabled === String(owner) &&
                status.textContent.toLowerCase().includes(owner ? 'ваш ход' : 'только просмотр');
        }""", arg={"plies": plies, "owner": owner, "key": STORAGE_KEY},
        timeout=TURN_TIMEOUT_MS)
    require(not (await page.locator("#error").text_content()).strip(),
            "Application displayed an error")


async def wait_sprites_and_network(page):
    await page.wait_for_function(
        """pieces => pieces.every(id =>
            document.querySelector('#cm-chessboard-sprite [id="' + id + '"]')) &&
            !!document.querySelector('#cm-chessboard-markers #markerDot')""",
        arg=list(PIECES), timeout=15000)
    await page.wait_for_load_state("networkidle", timeout=15000)


async def snapshot(page):
    return await page.evaluate(
        """key => ({
            fen: document.getElementById('fen').textContent.trim(),
            history: [...document.querySelectorAll('#history li')].map(x => x.textContent),
            saved: JSON.parse(localStorage.getItem(key) || 'null')
        })""", STORAGE_KEY)


async def assert_same(page, expected, reason):
    actual = await snapshot(page)
    require(actual == expected, reason + ": " + json.dumps(actual, ensure_ascii=False))


async def click_square(page, square):
    await page.locator('#board .board .square[data-square="%s"]' % square).click()


async def click_move(page, source, target):
    await click_square(page, source)
    await click_square(page, target)


async def drag_move(page, source, target):
    first = page.locator('#board .board .square[data-square="%s"]' % source)
    last = page.locator('#board .board .square[data-square="%s"]' % target)
    await first.scroll_into_view_if_needed()
    await last.scroll_into_view_if_needed()
    a, b = await first.bounding_box(), await last.bounding_box()
    require(a is not None and b is not None, "Drag squares are not visible")
    await page.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
    await page.mouse.down()
    try:
        await page.mouse.move(b["x"] + b["width"] / 2,
                              b["y"] + b["height"] / 2, steps=12)
    finally:
        await page.mouse.up()


async def assert_board_dom(page):
    for selector in ("main", "h1", "#board", "#board svg.cm-chessboard"):
        require(await page.locator(selector).count() == 1,
                "Expected exactly one " + selector)
    require(await page.locator("#board .board .square[data-square]").count() == 64,
            "cm-chessboard must render 64 squares")
    state = await snapshot(page)
    expected_pieces = sum(c.isalpha() for c in state["fen"].split()[0])
    require(await page.locator("#board .pieces use.piece").count() == expected_pieces,
            "Rendered SVG pieces disagree with the displayed FEN")
    for piece in PIECES:
        require(await page.locator('#cm-chessboard-sprite [id="%s"]' % piece).count() == 1,
                "Expected one real SVG piece definition: " + piece)


async def settle_layout(page):
    await page.evaluate("""() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)))""")


async def layout_metrics(page):
    await settle_layout(page)
    await assert_board_dom(page)
    metrics = await page.evaluate("""() => {
        const box = selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const r = element.getBoundingClientRect();
            return {left:r.left, right:r.right, top:r.top, bottom:r.bottom,
                    width:r.width, height:r.height, documentTop:r.top+scrollY};
        };
        return {viewport:{width:innerWidth,height:innerHeight}, scrollY,
            scrollWidth:document.documentElement.scrollWidth,
            scrollHeight:document.documentElement.scrollHeight,
            main:box('main'), h1:box('h1'), board:box('#board svg.cm-chessboard'),
            aside:box('aside'), footer:box('footer')};
    }""")
    width = metrics["viewport"]["width"]
    board = metrics["board"]
    require(metrics["scrollWidth"] <= width + 1, "Document overflows horizontally")
    require(board["left"] >= -1 and board["right"] <= width + 1,
            "Board exceeds the viewport width")
    require(board["width"] > 160 and abs(board["width"] - board["height"]) <= 3,
            "Board has invalid dimensions")
    return metrics


async def capture_layouts(page, evidence):
    for width, height, name in ((1400, 1000, "desktop.png"),
                                (768, 1024, "tablet-top.png")):
        await page.set_viewport_size({"width": width, "height": height})
        await page.evaluate("window.scrollTo(0, 0)")
        metrics = await layout_metrics(page)
        await evidence.screenshot(page, name)
        evidence.completed("layout_%d_top" % width, metrics=metrics)
    top = await layout_metrics(page)
    max_scroll = max(0, top["scrollHeight"] - top["viewport"]["height"])
    target = min(650, max_scroll)
    await page.evaluate("y => window.scrollTo(0, y)", target)
    lower = await layout_metrics(page)
    require(0 <= lower["scrollY"] < top["viewport"]["height"],
            "Tablet screenshots must overlap")
    require(max_scroll == 0 or lower["scrollY"] > 0, "Tablet page did not scroll")
    await evidence.screenshot(page, "tablet-scroll.png")
    evidence.completed("layout_768_overlapping_scroll", metrics=lower,
                       scroll_unneeded=max_scroll == 0,
                       overlap_pixels=top["viewport"]["height"] - lower["scrollY"])
    await page.set_viewport_size({"width": 390, "height": 844})
    await page.evaluate("window.scrollTo(0, 0)")
    metrics = await layout_metrics(page)
    await evidence.screenshot(page, "mobile-top.png")
    evidence.completed("layout_390_top", metrics=metrics)


async def gameplay(browser, evidence):
    context = await evidence.context(browser, "gameplay")
    page = await context.new_page()
    evidence.current_page = page
    await page.goto(evidence.args.base_url, wait_until="domcontentloaded")
    await wait_ready(page, 0)
    await wait_sprites_and_network(page)
    await assert_board_dom(page)
    require(await page.locator("#board .pieces use.piece").count() == 32,
            "Initial position must contain 32 pieces")
    evidence.report["user_agent"] = await page.evaluate("navigator.userAgent")
    evidence.completed("real_cm_chessboard_initial_position")

    initial = await snapshot(page)
    await click_square(page, "e2")
    await click_square(page, "g1")
    await page.wait_for_function("document.getElementById('move-from').value === 'g1'")
    await wait_ready(page, 0)
    await assert_same(page, initial, "Selecting another own piece changed the game")
    evidence.completed("own_piece_reselection_is_not_an_illegal_move")

    await click_move(page, "e2", "e4")
    await wait_ready(page, 2)
    first = await snapshot(page)
    require(first["saved"]["moves"][0] == "e2e4", "Click did not commit e2e4")
    evidence.completed("click_e2e4_and_real_black_reply", saved=first)

    await drag_move(page, "g1", "f3")
    await wait_ready(page, 4)
    after_drag = await snapshot(page)
    require(after_drag["saved"]["moves"][:2] == first["saved"]["moves"] and
            after_drag["saved"]["moves"][2] == "g1f3", "Drag did not commit g1f3")
    evidence.completed("drag_g1f3_and_real_black_reply", saved=after_drag)

    await page.reload(wait_until="domcontentloaded")
    await wait_ready(page, 4)
    await wait_sprites_and_network(page)
    await assert_same(page, after_drag, "Reload changed history, state, or FEN")
    evidence.completed("reload_preserves_history_and_fen")

    a1 = page.locator('#board .board .square[data-square="a1"]')
    before = await a1.bounding_box()
    await page.get_by_role("button", name="Перевернуть доску", exact=True).click()
    await page.wait_for_function("document.getElementById('board').dataset.orientation === 'b'")
    await wait_ready(page, 4)
    await settle_layout(page)
    after = await a1.bounding_box()
    require(before and after and abs(after["x"] - before["x"]) > before["width"] * 5,
            "Flip did not move the actual a1 square to the opposite side")
    await assert_same(page, after_drag, "Flip changed the game")
    await page.get_by_role("button", name="Перевернуть доску", exact=True).click()
    await page.wait_for_function("document.getElementById('board').dataset.orientation === 'w'")
    await wait_ready(page, 4)
    evidence.completed("flip_preserves_game")

    await click_move(page, "f3", "f5")
    await page.wait_for_timeout(250)
    await assert_same(page, after_drag, "Illegal knight move changed the game")
    validation_message = (await page.locator("#error").text_content()).strip()
    require(validation_message == "На эту клетку сейчас нельзя пойти.",
            "Illegal move did not display the expected validation message")
    evidence.completed("illegal_move_rejected", validation_message=validation_message)
    # The rejection message is intentional UI feedback. No further ready-state
    # assertion is made on this owner page; the fresh observer has a clean UI.

    observer = await context.new_page()
    evidence.current_page = observer
    await observer.goto(evidence.args.base_url, wait_until="domcontentloaded")
    await wait_ready(observer, 4, owner=False)
    await wait_sprites_and_network(observer)
    await assert_same(observer, after_drag, "Observer did not restore the shared game")
    await observer.locator("#keyboard-move summary").click()
    require(await observer.get_by_label("Откуда", exact=True).is_disabled() and
            await observer.get_by_label("Куда", exact=True).is_disabled(),
            "Observer keyboard controls must be disabled")
    await click_move(observer, "b1", "c3")
    await observer.wait_for_timeout(250)
    await assert_same(observer, after_drag, "Observer committed a move")
    await assert_same(page, after_drag, "Observer changed the owner's game")
    evidence.completed("observer_is_read_only")

    await page.wait_for_load_state("networkidle")
    await page.close()
    await wait_ready(observer, 4)
    await observer.get_by_label("Откуда", exact=True).select_option("b1")
    await observer.get_by_label("Куда", exact=True).select_option("c3")
    await observer.get_by_role("button", name="Сделать ход", exact=True).click()
    await wait_ready(observer, 6)
    takeover = await snapshot(observer)
    require(takeover["saved"]["moves"][:4] == after_drag["saved"]["moves"] and
            takeover["saved"]["moves"][4] == "b1c3",
            "Takeover or Russian keyboard move did not preserve game history")
    evidence.completed("takeover_russian_keyboard_move_and_real_reply", saved=takeover)
    await observer.locator("#keyboard-move summary").click()
    await capture_layouts(observer, evidence)
    await observer.wait_for_load_state("networkidle")
    evidence.verify_assets("gameplay")


async def seeded_context(browser, evidence, label, state):
    context = await evidence.context(browser, label)
    origin = "{0.scheme}://{0.netloc}".format(urlparse(evidence.args.base_url))
    seed = """(() => {
        const origin = %s, key = %s, state = %s;
        if (location.origin === origin && localStorage.getItem(key) === null) {
            localStorage.setItem(key, JSON.stringify(state));
        }
    })();""" % (json.dumps(origin), json.dumps(STORAGE_KEY), json.dumps(state))
    await context.add_init_script(script=seed)
    return context


async def promotion(browser, evidence):
    context = await seeded_context(browser, evidence, "promotion", PROMOTION_STATE)
    page = await context.new_page()
    evidence.current_page = page
    await page.goto(evidence.args.base_url, wait_until="domcontentloaded")
    await wait_ready(page, 8)
    await wait_sprites_and_network(page)
    await assert_board_dom(page)
    initial = await snapshot(page)
    require(initial["fen"] == PROMOTION_FEN and initial["saved"] == PROMOTION_STATE,
            "Esca did not restore the verified promotion fixture")
    evidence.completed("valid_promotion_history_restored_by_esca", saved=initial)

    dialog = page.get_by_role("dialog", name="Превращение пешки", exact=True)
    await click_move(page, "b7", "a8")
    await dialog.wait_for(state="visible")
    require(await dialog.locator("[data-promotion]").count() == 4,
            "Promotion must offer all four pieces")
    await page.wait_for_timeout(250)
    await assert_same(page, initial, "Promotion committed before a piece was selected")
    await dialog.get_by_role("button", name="Отмена", exact=True).click()
    await dialog.wait_for(state="hidden")
    await wait_ready(page, 8)
    await assert_same(page, initial, "Canceling promotion changed the game")
    evidence.completed("promotion_waits_for_choice_and_cancel_preserves_game")

    await click_move(page, "b7", "a8")
    await dialog.wait_for(state="visible")
    await dialog.get_by_role("button", name="Конь", exact=True).click()
    await dialog.wait_for(state="hidden")
    await wait_ready(page, 10)
    promoted = await snapshot(page)
    require(promoted["saved"]["moves"][:8] == PROMOTION_MOVES and
            promoted["saved"]["moves"][8] == "b7a8n",
            "Selected knight promotion was not committed exactly once")
    require(piece_at(promoted["fen"], "a8") == "N", "Selected knight is absent from a8")
    require(re.fullmatch(r"[a-h][1-8][a-h][1-8][qrbn]?",
                         promoted["saved"]["moves"][9]) is not None,
            "Promotion did not receive a real committed Black reply")
    await assert_board_dom(page)
    await page.wait_for_load_state("networkidle")
    evidence.verify_assets("promotion")
    evidence.completed("knight_underpromotion_and_real_black_reply", saved=promoted)


async def history_labels(browser, evidence):
    for fixture in HISTORY_FIXTURES:
        state = {"schema": 1, "revision": len(fixture["moves"]),
                 "moves": fixture["moves"], "skill": 5, "finish": None}
        context = await seeded_context(browser, evidence, fixture["name"], state)
        page = await context.new_page()
        evidence.current_page = page
        await page.goto(evidence.args.base_url, wait_until="domcontentloaded")
        await wait_ready(page, len(fixture["moves"]))
        await wait_sprites_and_network(page)
        await assert_board_dom(page)
        restored = await snapshot(page)
        require(restored["saved"] == state, "Esca did not restore the history fixture")
        for square, piece in fixture["pieces"].items():
            require(piece_at(restored["fen"], square) == piece,
                    "History fixture has an unexpected piece on " + square)
        row = page.locator('#history li[data-ply="%s"]' % fixture["ply"])
        require(await row.locator("span").last.text_content() == fixture["label"],
                "Visible history misclassified castling or an ordinary rook move")
        accessible = "%d. Белые, %s" % ((fixture["ply"] + 1) // 2, fixture["label"])
        require(await row.get_attribute("aria-label") == accessible,
                "Accessible history disagrees with visible move classification")
        evidence.completed(fixture["name"], saved=restored,
                           ply=fixture["ply"], label=fixture["label"])


async def suite(browser, evidence):
    await gameplay(browser, evidence)
    await promotion(browser, evidence)
    await history_labels(browser, evidence)


async def run(args):
    evidence = Evidence(args)
    browser = None
    try:
        async with async_playwright() as playwright:
            try:
                browser = await playwright.chromium.launch(
                    executable_path=str(args.browser), headless=True)
                evidence.report["browser_version"] = browser.version
                await asyncio.wait_for(suite(browser, evidence), SUITE_TIMEOUT_SECONDS)
            except BaseException:
                page = evidence.current_page
                if page is not None and not page.is_closed():
                    try:
                        await page.screenshot(path=str(args.evidence_dir / "failure.png"),
                                              full_page=False, timeout=3000)
                    except Exception as screenshot_error:
                        evidence.diagnostic("failure_screenshot", "cleanup",
                                            message=str(screenshot_error))
                raise
            finally:
                for label, context in reversed(evidence.contexts):
                    try:
                        await asyncio.wait_for(context.close(), 5)
                    except Exception as close_error:
                        evidence.diagnostic("context_close", label, message=str(close_error))
                if browser is not None:
                    try:
                        await asyncio.wait_for(browser.close(), 5)
                    except Exception as close_error:
                        evidence.diagnostic("browser_close", "cleanup", message=str(close_error))
        outside = [r for r in evidence.requests
                   if urlparse(r["url"]).scheme in ("http", "https")
                   and not r["url"].startswith(args.base_url)]
        require(not outside, "Unexpected requests outside the project URL: " + json.dumps(outside))
        require(not evidence.diagnostics,
                "Strict browser diagnostics are not empty: " + json.dumps(evidence.diagnostics))
        require(len(evidence.screenshots) == 4, "Expected four ordinary viewport screenshots")
        evidence.report["status"] = "PASS"
    except BaseException as error:
        evidence.report["status"] = "FAIL"
        evidence.report["failure"] = {"type": type(error).__name__, "message": str(error),
                                      "traceback": traceback.format_exc()}
        raise
    finally:
        evidence.report["finished_utc"] = utc_now()
        evidence.report["elapsed_seconds"] = round(time.monotonic() - evidence.started, 3)
        evidence.report["diagnostic_count"] = len(evidence.diagnostics)
        evidence.report["request_count"] = len(evidence.requests)
        evidence.report["response_count"] = len(evidence.responses)
        write_json(args.evidence_dir / "diagnostics.json", {
            "diagnostics": evidence.diagnostics, "requests": evidence.requests,
            "responses": evidence.responses})
        write_json(args.evidence_dir / "report.json", evidence.report)
    return evidence.report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True,
                        help="Existing HTTP(S) project URL, including trailing slash")
    parser.add_argument("--browser", required=True, type=Path,
                        help="Exact executable path of an already approved browser")
    parser.add_argument("--evidence-dir", required=True, type=Path,
                        help="Fresh directory for JSON evidence and viewport screenshots")
    args = parser.parse_args()
    try:
        args.base_url = normalize_base_url(args.base_url)
    except ValueError as error:
        parser.error(str(error))
    args.browser = args.browser.expanduser().resolve()
    if not args.browser.is_file() or not os.access(str(args.browser), os.X_OK):
        parser.error("--browser is not an existing executable; no browser will be installed or substituted")
    args.evidence_dir = args.evidence_dir.expanduser().resolve()
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    owned = ("report.json", "diagnostics.json", "desktop.png", "tablet-top.png",
             "tablet-scroll.png", "mobile-top.png", "failure.png")
    if any((args.evidence_dir / name).exists() for name in owned):
        parser.error("Use a fresh evidence directory; existing test evidence will not be overwritten")
    try:
        report = asyncio.run(run(args))
    except BaseException:
        traceback.print_exc()
        return 1
    print(json.dumps({"acceptance": report["status"],
                      "checks_completed": len(report["checks"]),
                      "diagnostics": report["diagnostic_count"],
                      "evidence_dir": str(args.evidence_dir)}, ensure_ascii=False), flush=True)
    print("PASS Alfred Chess UI v2 acceptance", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
