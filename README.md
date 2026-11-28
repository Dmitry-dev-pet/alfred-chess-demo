# Alfred Chess Demo

A free experimental standalone chess board. Esca checks every move and calculates positional facts; Stockfish 19 Lite is the local opponent. All game processing is in the browser. No account, server-side game, API key, AI subscription, or remote chess endpoint is required. The current demo is not yet an AI-language-model coach. A modern HTTPS browser with WebAssembly, gzip DecompressionStream, Workers and Web Locks is required. See [credits and third-party licenses](credits.html).

## Open-source board interface

The interface uses **cm-chessboard 8.15.8**, pinned to upstream commit `1a9e26a7de5fe2830a2d43a7a8bf25cc7afb60f5`. Its JavaScript, CSS and SVG assets are served locally; no CDN, package installation or runtime build is required. The board displays the position and accepts gestures. Esca remains the source of legal moves; the saved game is committed before the board is updated. The browser storage key remains `alfred-chess-demo.v1` so existing games carry over.

The board code and CSS are MIT. The unchanged Wikimedia Standard piece sprite (Cburnett, Rfc1394; adapted by shaack) and marker sprite (shaack) are separately CC BY-SA 3.0. Their author notices, complete license text, source references and hashes are included in [credits](credits.html) and [vendor provenance](vendor/cm-chessboard/PROVENANCE.json). Third-party licenses do not license unrelated Alfred software.

## Development and verification

Serve this directory from an HTTP server bound to `127.0.0.1`, or use HTTPS. Opening `index.html` as a local `file:` URL is insufficient for module, Worker and Web Locks behavior. Keep the Pages project prefix `/alfred-chess-demo/` when verifying a release. No package installation is needed for the site.

The publication workflow verifies an exact set of files and SHA-256 hashes, then stages only the public static payload. Source-only documentation and acceptance scripts are excluded from the Pages artifact. Preparing a review branch does not publish it; release authorization and actual Pages results are recorded separately.

## Optional conversational coach

[Connection design](docs/COACH_CONNECTION.md) describes a proposed authenticated service and official model access options. It is a design document, not a running GPT connection. The current game makes no language-model requests and needs no model credentials.

The bundled Stockfish.js assets are unmodified upstream GPLv3 binaries. Corresponding source: [exact upstream source archive](https://github.com/nmrugg/stockfish.js/archive/9cb3e5066d48f1a35d792afeda36eff37ae60570.tar.gz); [build instructions and script](https://github.com/nmrugg/stockfish.js/tree/9cb3e5066d48f1a35d792afeda36eff37ae60570); [Lite network](https://tests.stockfishchess.org/nns?network_name=nn-61e7af4bb97d.nnue). These public source locations accompany the binaries; [GPLv3 text](licenses/stockfish-19-lite/Copying.txt).

Esca 0.4.0 is MIT, [source](https://github.com/AnglerfishChess/esca/tree/5c801e7fa716a4a8691a51f4adcd33d9c362b93d). [WASM adapter](source/esca-wrapper/) and license notices are included. Third-party works retain their own licenses; publication of the Alfred demo does not grant a license to unrelated Alfred software.

The Esca module is stored losslessly as `engine/esca.wasm.gz`. Its uncompressed SHA-256 is `de98c96c1ef24fcdfa64fb497f9ddcf1be9060240cc3a82adf5a512b575a382f`.
