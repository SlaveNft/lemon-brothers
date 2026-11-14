//! Replays whole crisis games recorded by the TypeScript engine (packages/sim/scripts/crisis-vectors.ts ->
//! tests/crisis-vectors.json) and requires every day, the ending and the score to match. Regenerate with
//! `npm run vectors` in chair/.

use crisis_core::{decode_moves, Crisis};
use serde_json::Value;

#[test]
fn the_contract_scores_every_game_as_the_browser_does() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/crisis-vectors.json")).expect("run `npm run vectors` first");
    let games: Vec<Value> = serde_json::from_str(&raw).unwrap();
    assert!(games.len() >= 300);
    let mut days = 0;
    for g in &games {
        let seed = g["seed"].as_u64().unwrap() as u32;
        let moves = decode_moves(g["moves"].as_str().unwrap()).expect("moves decode");
        let ctx = format!("seed {seed} moves {}", g["moves"]);
        let mut c = Crisis::new(seed);
        for m in &moves { c.play(m); }
        let r = c.result().unwrap_or_else(|| panic!("{ctx}: the game did not end"));
        for (i, (got, want)) in r.days.iter().zip(g["days"].as_array().unwrap()).enumerate() {
            let cx = format!("{ctx} day {i}");
            assert_eq!(got.card, want["card"].as_str().unwrap(), "{cx}: card");
            assert_eq!(got.rejected, want["rejected"].as_bool().unwrap(), "{cx}: rejected");
            assert_eq!(got.ran as u64, want["ran"].as_u64().unwrap(), "{cx}: runners");
            assert_eq!(got.avg_panic, want["avg_panic"].as_i64().unwrap(), "{cx}: average panic");
            assert_eq!(got.reserve_permille, want["reserve_permille"].as_i64().unwrap(), "{cx}: vault");
            assert_eq!(got.credibility, want["credibility"].as_i64().unwrap(), "{cx}: credibility");
            assert_eq!(got.collapsed, want["collapsed"].as_bool().unwrap(), "{cx}: collapsed");
            days += 1;
        }
        let w = &g["result"];
        assert_eq!(r.days.len(), g["days"].as_array().unwrap().len(), "{ctx}: days");
        assert_eq!(r.ending.as_str(), w["ending"].as_str().unwrap(), "{ctx}: ending");
        assert_eq!(r.score as u64, w["score"].as_u64().unwrap(), "{ctx}: score");
        assert_eq!(r.kept as u64, w["kept"].as_u64().unwrap(), "{ctx}: kept");
        assert_eq!(r.of as u64, w["of"].as_u64().unwrap(), "{ctx}: of");
        assert_eq!(r.printed_permille, w["printed_permille"].as_i64().unwrap(), "{ctx}: printed");
    }
    println!("crisis parity: {} games, {days} days", games.len());
}
