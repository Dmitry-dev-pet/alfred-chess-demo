use std::cell::RefCell;
use serde::Deserialize;
use serde_json::{json, Value};
use esca::{Game, classic};

// A small single-threaded smoke-test ABI. Buffers are owned by WASM;
// callers copy input into the returned address, then copy output out
// before invoking another operation. Not a production API.
thread_local! {
    static INPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Query { fen: Option<String>, moves: Vec<String> }

fn compute(bytes: &[u8]) -> Result<Value, String> {
    let q: Query = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if q.moves.len() > 512 { return Err("history exceeds probe limit".into()); }
    let mut g = match q.fen {
        Some(fen) => Game::from_fen(classic(), &fen).map_err(|e| format!("invalid FEN: {e:?}"))?,
        None => Game::new(classic()),
    };
    for uci in q.moves { g.play_uci(&uci).map_err(|e| format!("illegal move {uci}: {e:?}"))?; }
    let legal: Vec<_> = g.legal_moves().iter().map(|m| g.move_to_uci(*m)).collect();
    let annotations: Vec<_> = g.annotated_moves().iter().map(|m| json!({"uci":g.move_to_uci(m.mv), "facts": m.facts})).collect();
    Ok(json!({"fen":g.position().fen(), "legal_moves":legal, "facts":g.facts(), "annotations":annotations,
        "repetitions":g.repetitions(), "claims":g.claims().iter().map(|c|format!("{c:?}")).collect::<Vec<_>>(), "outcome":g.outcome().map(|o|format!("{o:?}"))}))
}
#[unsafe(no_mangle)]
pub extern "C" fn probe_input(len: usize) -> *mut u8 {
    if len == 0 || len > 65536 { return std::ptr::null_mut(); }
    INPUT.with(|b| { let mut b=b.borrow_mut(); b.resize(len,0); b.as_mut_ptr() })
}
#[unsafe(no_mangle)]
pub extern "C" fn probe_analyze() -> usize {
    let answer=INPUT.with(|b| compute(&b.borrow())).unwrap_or_else(|e| json!({"error":e}));
    let answer=serde_json::to_vec(&answer).expect("JSON response");
    OUTPUT.with(|b| { let len=answer.len(); *b.borrow_mut()=answer; len })
}
#[unsafe(no_mangle)]
pub extern "C" fn probe_output() -> *const u8 { OUTPUT.with(|b| b.borrow().as_ptr()) }
