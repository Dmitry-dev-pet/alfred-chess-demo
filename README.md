# Alfred Chess Demo

A free experimental standalone chess board. Esca checks every move and calculates positional facts; Stockfish 19 Lite is the local opponent. All game processing is in the browser. No account, server-side game, API key, AI subscription, or remote chess endpoint is required. The current demo is not yet an AI-language-model coach. A modern HTTPS browser with WebAssembly, gzip DecompressionStream, Workers and Web Locks is required. See [credits and third-party licenses](credits.html).

The bundled Stockfish.js assets are unmodified upstream GPLv3 binaries. Corresponding source: [exact upstream source archive](https://github.com/nmrugg/stockfish.js/archive/9cb3e5066d48f1a35d792afeda36eff37ae60570.tar.gz); [build instructions and script](https://github.com/nmrugg/stockfish.js/tree/9cb3e5066d48f1a35d792afeda36eff37ae60570); [Lite network](https://tests.stockfishchess.org/nns?network_name=nn-61e7af4bb97d.nnue). These public source locations accompany the binaries; [GPLv3 text](licenses/stockfish-19-lite/Copying.txt).

Esca 0.4.0 is MIT, [source](https://github.com/AnglerfishChess/esca/tree/5c801e7fa716a4a8691a51f4adcd33d9c362b93d). [WASM adapter](source/esca-wrapper/) and license notices are included. Third-party works retain their own licenses; publication of the Alfred demo does not grant a license to unrelated Alfred software.

The Esca module is stored losslessly as `engine/esca.wasm.gz`. Its uncompressed SHA-256 is `de98c96c1ef24fcdfa64fb497f9ddcf1be9060240cc3a82adf5a512b575a382f`.
