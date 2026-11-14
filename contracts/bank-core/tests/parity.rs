//! Replays the simulation's vectors (packages/sim/scripts/vectors.ts -> tests/vectors.json) through the Rust core.
//! Every step must agree on accept/reject and on the whole state. Regenerate with `npm run vectors` in chair/.

use bank_core::{Bank, Policy};
use serde_json::Value;

fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        other => other.to_string(),
    }
}
fn n(v: &Value) -> u128 {
    match v {
        Value::String(x) => x.parse().unwrap(),
        Value::Number(x) => x.as_u64().unwrap() as u128,
        _ => panic!("not a number: {v}"),
    }
}

#[test]
fn simulation_and_contract_agree() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/vectors.json")).expect("run `npm run vectors` first");
    let scenarios: Vec<Value> = serde_json::from_str(&raw).unwrap();
    assert!(!scenarios.is_empty());
    let mut steps = 0;
    for sc in &scenarios {
        let genesis: Vec<(String, u128)> = sc["genesis"].as_array().unwrap().iter().map(|g| (s(&g[0]), n(&g[1]))).collect();
        let mut b = Bank::new("dao", "chair", &genesis);
        for (i, step) in sc["ops"].as_array().unwrap().iter().enumerate() {
            let op = &step["op"];
            let who = s(&op["who"]);
            let r: Result<(), String> = match op["op"].as_str().unwrap() {
                "deposit" => b.deposit(&who, n(&op["amount"])),
                "withdraw" => b.withdraw(&who, n(&op["amount"])),
                "withdraw_all" => b.withdraw_all(&who),
                "advance" => { b.advance_epoch(n(&op["shock"])); Ok(()) }
                "set_policy" => b.set_policy(&s(&op["caller"]), Policy {
                    rate: n(&op["rate"]), target: n(&op["target"]), mint: n(&op["mint"]), gate: n(&op["gate"]),
                    tone: s(&op["tone"]), statement: s(&op["statement"]), attestation: String::new(),
                }),
                "insure" => b.insure(&who, n(&op["premium"])),
                "lobby" => b.lobby(&who, &s(&op["text"])),
                "rumor" => b.rumor(&who, &s(&op["kind"])),
                "airdrop" => b.airdrop(&who),
                "set_chair" => b.set_chair(&s(&op["caller"]), &s(&op["chair"])),
                "noop_value" => Ok(()),
                other => panic!("unknown op {other}"),
            };
            let ctx = format!("seed {} step {} op {}", sc["seed"], i, op);
            assert_eq!(r.is_ok(), step["ok"].as_bool().unwrap(), "{ctx}: accept/reject differs ({r:?})");
            let st = &step["state"];
            assert_eq!(b.supply, n(&st["supply"]), "{ctx}: supply");
            assert_eq!(b.max_supply, n(&st["max_supply"]), "{ctx}: max_supply");
            // the ceiling holds after every operation, whatever was tried
            assert!(b.supply <= b.max_supply, "{ctx}: supply {} above the ceiling {}", b.supply, b.max_supply);
            assert_eq!(b.reserve, n(&st["reserve"]), "{ctx}: reserve");
            assert_eq!(b.loans, n(&st["loans"]), "{ctx}: loans");
            assert_eq!(b.total_shares, n(&st["total_shares"]), "{ctx}: total_shares");
            assert_eq!(b.index, n(&st["index"]), "{ctx}: index");
            assert_eq!(b.collapsed, st["collapsed"].as_bool().unwrap(), "{ctx}: collapsed");
            assert_eq!(b.epoch as u128, n(&st["epoch"]), "{ctx}: epoch");
            assert_eq!(b.round as u128, n(&st["round"]), "{ctx}: round");
            assert_eq!(b.epoch_id as u128, n(&st["epoch_id"]), "{ctx}: epoch_id");
            assert_eq!(b.minted_this_round, n(&st["minted_this_round"]), "{ctx}: minted_this_round");
            assert_eq!(b.policy.rate, n(&st["rate"]), "{ctx}: rate");
            assert_eq!(b.policy.target, n(&st["target"]), "{ctx}: target");
            assert_eq!(b.policy.gate, n(&st["gate"]), "{ctx}: gate");
            assert_eq!(b.chair, s(&st["chair"]), "{ctx}: chair");
            let order: Vec<String> = st["order"].as_array().unwrap().iter().map(s).collect();
            assert_eq!(b.order, order, "{ctx}: account order");
            for (id, wv) in st["accounts"].as_object().unwrap() {
                let a = &b.accounts[id];
                assert_eq!(a.wallet, n(&wv[0]), "{ctx}: wallet of {id}");
                assert_eq!(a.shares, n(&wv[1]), "{ctx}: shares of {id}");
            }
            assert_eq!(b.supply, b.sum_wallets() + b.reserve + b.loans, "{ctx}: conservation");
            steps += 1;
        }
    }
    println!("parity: {} scenarios, {steps} steps", scenarios.len());
}
