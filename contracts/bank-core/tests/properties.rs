//! Property test: random sequences of every player, chair and clock action over a small town, with the bank's
//! invariants checked after each step (whether the action was accepted or refused):
//!
//! - every LEMON is somewhere: supply == wallets + reserve + loans + what collapses still owe (`unsettled`);
//! - the supply never passes the ceiling;
//! - the shares on the books are exactly the shares of the accounts that hold them in the current era;
//! - a refused action changes nothing;
//! - a withdrawal never pays more than the deposit is worth, and no policy prints past its caps;
//! - after a collapse, settling everyone leaves at most rounding dust owed (two coins per account).
//!
//! No dependencies: a fixed xorshift generator, so a failure names its run and step and reproduces exactly.

use bank_core::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next() % n }
    }
    fn pick<'a>(&mut self, xs: &'a [String]) -> &'a str {
        &xs[self.below(xs.len() as u64) as usize]
    }
}

/// The figures a refused action must leave untouched: the totals, then every account's wallet and shares.
type Snapshot = ([u128; 8], Vec<(String, u128, u128)>);

fn snapshot(b: &Bank) -> Snapshot {
    let accts = b.accounts.iter().map(|(k, a)| (k.clone(), a.wallet, a.shares)).collect();
    ([b.supply, b.reserve, b.loans, b.total_shares, b.index, b.unsettled, b.minted_this_round, b.insured_total], accts)
}

fn check(b: &Bank, ctx: &str) {
    assert_eq!(b.supply, b.sum_wallets() + b.reserve + b.loans + b.unsettled, "conservation, {ctx}");
    assert!(b.max_supply == 0 || b.supply <= b.max_supply, "ceiling {} passed: {}, {ctx}", b.max_supply, b.supply);
    let shares: u128 = b.accounts.values().filter(|a| a.era >= b.era).map(|a| a.shares).sum();
    if !b.collapsed {
        assert_eq!(b.total_shares, shares, "shares on the books, {ctx}");
    }
    assert!(b.minted_this_round <= b.round_start_supply * MINT_ROUND_PERMILLE / 1000, "round print cap, {ctx}");
}

#[test]
fn random_towns_keep_every_invariant() {
    let (mut steps, mut accepted, mut collapses, mut policies) = (0u64, 0u64, 0u64, 0u64);
    for run in 0..250u64 {
        let mut rng = Rng(0x9e37_79b9_7f4a_7c15 ^ (run + 1).wrapping_mul(0x2545_f491_4f6c_dd1d));
        let n = 3 + rng.below(10) as usize;
        let ids: Vec<String> = (0..n).map(|i| format!("p{i}")).collect();
        let genesis: Vec<(String, u128)> = ids.iter().map(|w| (w.clone(), 500 + rng.below(20_000) as u128)).collect();
        let mut b = Bank::new("dao", "chair", &genesis);
        check(&b, &format!("run {run} genesis"));
        for step in 0..400u64 {
            steps += 1;
            let ctx = format!("run {run} step {step}");
            let before = snapshot(&b);
            let who = rng.pick(&ids).to_string();
            let value_before = b.value_of(&who);
            let wallet_before = b.accounts.get(&who).map(|a| a.wallet).unwrap_or(0);
            let collapsed_before = b.collapsed;
            let dust_before = b.unsettled;
            let r: R = match rng.below(14) {
                0..=2 => {
                    let w = b.accounts.get(&who).map(|a| a.wallet).unwrap_or(0);
                    b.deposit(&who, rng.below(w as u64 + 50) as u128)
                }
                3..=4 => b.withdraw(&who, rng.below(value_before as u64 + 50) as u128),
                5 => b.withdraw_all(&who),
                6 => {
                    let to = rng.pick(&ids).to_string();
                    b.transfer(&who, &to, rng.below(2_000) as u128)
                }
                7 => b.insure(&who, rng.below(600) as u128),
                8 => {
                    // mostly near the current policy (so many pass the step limits), sometimes anywhere
                    let (cr, ct) = (b.policy.rate as i64, b.policy.target as i64);
                    let near = rng.below(4) != 0;
                    let rate = if near { (cr + rng.below(161) as i64 - 80).max(0) } else { rng.below(400) as i64 };
                    let target = if near { (ct + rng.below(321) as i64 - 160).max(0) } else { rng.below(900) as i64 };
                    let p = Policy {
                        rate: rate as u128,
                        target: target as u128,
                        mint: rng.below(b.supply as u64 / 10 + 1) as u128,
                        gate: [0, 50, 100, 500, 5_000][rng.below(5) as usize],
                        tone: TONES[rng.below(4) as usize].into(),
                        ..Policy::default_policy()
                    };
                    let caller = if rng.below(8) == 0 { who.clone() } else { "chair".into() };
                    b.set_policy(&caller, p)
                }
                9 | 10 => {
                    let shock = if rng.below(5) == 0 { (SHOCK_MIN + rng.below((SHOCK_MAX - SHOCK_MIN + 1) as u64) as u32) as u128 } else { 0 };
                    b.advance_epoch(shock);
                    Ok(())
                }
                11 => { b.settle(&who); Ok(()) }
                12 => b.lobby(&who, "print more"),
                _ => b.rumor(&who, RUMORS[rng.below(3) as usize]),
            };
            if r.is_ok() { accepted += 1; }
            if b.events.iter().any(|e| matches!(e, Event::Policy { .. })) { policies += 1; }
            b.events.clear();
            if r.is_err() {
                assert_eq!(snapshot(&b), before, "a refused action changed the bank ({:?}), {ctx}", r);
            }
            // a withdrawal pays at most what the deposit was worth (a collapse pays nothing directly)
            let wallet_after = b.accounts.get(&who).map(|a| a.wallet).unwrap_or(0);
            if r.is_ok() && !collapsed_before && wallet_after > wallet_before && b.value_of(&who) < value_before {
                assert!(wallet_after - wallet_before <= value_before, "withdrawal paid more than the deposit, {ctx}");
            }
            check(&b, &ctx);
            if b.collapsed && !collapsed_before {
                collapses += 1;
                b.settle_all();
                b.events.clear();
                // each account's vault share and insurance payout round down once: at most two coins per account
                assert!(b.unsettled - dust_before < n as u128 * 2, "after settling everyone only dust is owed: {} new, {ctx}", b.unsettled - dust_before);
                check(&b, &format!("{ctx} settled"));
            }
        }
    }
    assert_eq!(steps, 250 * 400);
    // the sequences reach every corner: most actions go through, chairs print, banks fall
    assert!(accepted > steps / 2, "{accepted} of {steps} actions accepted");
    assert!(policies > 1_000 && collapses > 100, "{policies} policies, {collapses} collapses");
}
