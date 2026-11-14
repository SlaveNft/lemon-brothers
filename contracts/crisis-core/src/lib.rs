//! "You are the chair" — the crisis of the day — as a pure function of a seed and ten moves.
//!
//! The same game as `packages/sim/src/crisis.ts` (with `world.ts`, `agents.ts` and the bank in `bank-core`), step for
//! step, so the contract can replay a claimed result itself and record the score it computes, not the one it was told.
//! The parity test (`tests/parity.rs`) replays games recorded by the TypeScript engine and must match every day of
//! every game. Only what moves a number is here: the reasons and texts the page shows live in TypeScript.
//!
//! Arithmetic matches JavaScript exactly: integers where the TypeScript uses integers or BigInt, `f64` with the same
//! operations in the same order where it divides, and JavaScript's `Math.round`. Every panic change is rounded to a
//! whole number before it is added, so panics stay integers.

// The arithmetic is written out step by step, the way the TypeScript writes it; keep it that way.
#![allow(clippy::needless_range_loop, clippy::manual_checked_ops)]

use bank_core::{Bank, Policy};

// ------------------------------------------------------------------ the generator (packages/sim/src/rng.ts)

/// mulberry32, as `next` in rng.ts.
#[derive(Clone, Debug)]
pub struct Rng(pub u32);

impl Rng {
    pub fn u32(&mut self) -> u32 {
        let s = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        self.0 = s;
        t ^ (t >> 14)
    }
    /// Integer in [0, n).
    pub fn int(&mut self, n: u32) -> u32 {
        if n == 0 { 0 } else { self.u32() % n }
    }
    pub fn chance(&mut self, permille: u32) -> bool {
        self.int(1000) < permille
    }
}

/// JavaScript's `Math.round`: the nearest integer, halves toward +infinity.
pub fn js_round(x: f64) -> i64 {
    let f = x.floor();
    if x - f >= 0.5 { f as i64 + 1 } else { f as i64 }
}

// ------------------------------------------------------------------ the town (rules.ts AGENT, agents.ts)

const AGENTS: usize = 60;
const PANIC_START_MIN: i64 = 50;
const PANIC_START_SPAN: u32 = 200;
const THRESHOLD_MIN: i64 = 350;
const THRESHOLD_SPAN: u32 = 550;
const TIME_CALM: f64 = -20.0;
const CASH_CALM: f64 = -30.0;
const CRED_START: i64 = 1000;
const CRED_LIE_PENALTY: i64 = 200;
const CRED_FLOOR: i64 = 200;
const CRED_RECOVER: i64 = 50;
const CRED_LIE_OUTFLOW: i64 = 60;
const RATE_HIKE_BPS: i64 = 50;
const RATE_HIKE_PANIC: f64 = 60.0;
const GATE_PANIC: f64 = 150.0;
const MINT_CALM: f64 = -40.0;
const MINT_WORRY: f64 = 20.0;
const MINT_WORRY_HUNGER: i64 = 600;
const TARGET_RAISED: f64 = -30.0;
const OUTFLOW_CAP: i64 = 250;
const FRIEND_RAN: i64 = 90;
const FRIEND_RAN_CAP: i64 = 300;
const LOW_RESERVE_PERMILLE: i64 = 100;
const LOW_RESERVE_PANIC: f64 = 100.0;
const RUMOR_PANIC: f64 = 150.0;
const WRITEDOWN_PER_PERMILLE: i64 = 3;
const LIFE_EVENT_PERMILLE: u32 = 30;
const LIFE_SHARE_MIN: u32 = 300;
const LIFE_SHARE_MAX: u32 = 700;
const NOISE: u32 = 40;
const DEPOSIT_RATE_MIN_BPS: u128 = 60;
const ROUND_PANIC_KEEP: i64 = 400;
const SHOCK_CHANCE: u32 = 150;
const SHOCK_MIN: u32 = 30;
const SHOCK_MAX: u32 = 150;

fn tone_panic(tone: &str) -> f64 {
    match tone { "calm" => -40.0, "confident" => -30.0, "cautious" => 20.0, _ => 120.0 }
}

#[derive(Clone, Debug)]
pub struct Agent {
    pub id: String,
    pub panic: i64,
    pub base: i64,
    pub threshold: i64,
    pub friends: Vec<usize>,
    pub trust: i64,
    pub gullibility: i64,
    pub hunger: i64,
    pub ran_at: i64,
}

fn create_agents(rng: &mut Rng) -> Vec<Agent> {
    let mut agents = Vec::with_capacity(AGENTS);
    for i in 0..AGENTS {
        rng.int(12); // the surname draw (names live in TypeScript)
        let panic = PANIC_START_MIN + rng.int(PANIC_START_SPAN + 1) as i64;
        let threshold = THRESHOLD_MIN + rng.int(THRESHOLD_SPAN + 1) as i64;
        let trust = 200 + rng.int(801) as i64;
        let gullibility = rng.int(1001) as i64;
        let hunger = rng.int(1001) as i64;
        agents.push(Agent { id: format!("agent-{:02}", i + 1), panic, base: panic, threshold, friends: vec![], trust, gullibility, hunger, ran_at: -1 });
    }
    let n = AGENTS;
    for i in 0..n {
        let want = 3 + rng.int(4) as usize;
        let mut set: Vec<usize> = vec![(i + 1) % n, (i + n - 1) % n];
        while set.len() < want {
            let j = rng.int(n as u32) as usize;
            if j != i && !set.contains(&j) { set.push(j); }
        }
        agents[i].friends = set;
    }
    agents
}

fn act_order(rng: &mut Rng, n: usize) -> Vec<usize> {
    let mut order: Vec<usize> = (0..n).collect();
    for i in (1..n).rev() {
        let j = rng.int(i as u32 + 1) as usize;
        order.swap(i, j);
    }
    order
}

/// News the town reads this epoch: `by` scales it by the agent's trust or gullibility.
#[derive(Clone, Debug)]
pub struct News {
    pub delta: f64,
    pub by: Option<Trait>,
}

#[derive(Clone, Copy, Debug)]
pub enum Trait { Gullibility, Trust }

struct Signals<'a> {
    epoch_id: i64,
    tone: &'a str,
    credibility: i64,
    rate_change: i64,
    gate_on: bool,
    gate_just_on: bool,
    minted: bool,
    target_raised: bool,
    outflow_permille: i64,
    reserve_permille: i64,
    rumors: usize,
    writedown_permille: i64,
    cash_only: Vec<bool>,
    news: &'a [News],
}

fn update_panic(agents: &mut [Agent], s: &Signals, rng: &mut Rng) {
    let ran: Vec<bool> = agents.iter().map(|a| a.ran_at >= 0 && a.ran_at == s.epoch_id - 1).collect();
    for (idx, a) in agents.iter_mut().enumerate() {
        let mut total: i64 = 0;
        let mut add = |d: f64| total += js_round(d);
        add(TIME_CALM);
        if s.cash_only[idx] { add(CASH_CALM); }
        add(rng.int(2 * NOISE + 1) as f64 - NOISE as f64);
        add(tone_panic(s.tone) * a.trust as f64 * s.credibility as f64 / 1_000_000.0);
        if s.rate_change > RATE_HIKE_BPS { add(RATE_HIKE_PANIC); }
        if s.gate_just_on { add(GATE_PANIC); } else if s.gate_on { add(GATE_PANIC / 3.0); }
        if s.minted { add(if a.hunger > MINT_WORRY_HUNGER { MINT_WORRY } else { MINT_CALM }); }
        if s.target_raised { add(TARGET_RAISED); }
        add(OUTFLOW_CAP.min(s.outflow_permille) as f64);
        let friends_ran = a.friends.iter().filter(|f| ran[**f]).count() as i64;
        if friends_ran > 0 { add(FRIEND_RAN_CAP.min(friends_ran * FRIEND_RAN) as f64); }
        if s.writedown_permille > 0 { add((s.writedown_permille * WRITEDOWN_PER_PERMILLE) as f64); }
        if s.reserve_permille < LOW_RESERVE_PERMILLE { add(LOW_RESERVE_PANIC); }
        for r in 0..s.rumors {
            add(RUMOR_PANIC * a.gullibility as f64 / 1000.0 / if r == 0 { 1.0 } else { 2.0 });
        }
        for n in s.news {
            add(match n.by {
                Some(Trait::Gullibility) => n.delta * a.gullibility as f64 / 1000.0,
                Some(Trait::Trust) => n.delta * a.trust as f64 / 1000.0,
                None => n.delta,
            });
        }
        a.panic = (a.panic + total).clamp(0, 1000);
    }
}

fn cool_down(agents: &mut [Agent], keep_permille: i64) {
    for a in agents {
        a.panic = (a.base + js_round(((a.panic - a.base) * keep_permille) as f64 / 1000.0)).clamp(0, 1000);
    }
}

#[derive(PartialEq)]
enum Choice { Run, Deposit, Hold }

fn decide(a: &Agent, rate_bps: u128, has_wallet: bool, has_deposit: bool) -> Choice {
    if has_deposit && a.panic >= a.threshold { return Choice::Run; }
    // `a.panic < a.threshold / 2` in JavaScript compares with a possibly fractional half
    if has_wallet && ((a.panic * 2) < a.threshold) && rate_bps >= DEPOSIT_RATE_MIN_BPS { return Choice::Deposit; }
    Choice::Hold
}

// ------------------------------------------------------------------ the world (world.ts)

pub const CHAIR_ID: &str = "chair";
pub const DAO_ID: &str = "holders-dao";
const NPC: &str = "lemon-times";

pub struct World {
    pub rng: Rng,
    pub bank: Bank,
    pub agents: Vec<Agent>,
    pub credibility: i64,
    pub last_outflow_permille: i64,
    pub last_writedown_permille: i64,
}

fn open_round(w: &mut World) {
    for i in act_order(&mut w.rng, w.agents.len()) {
        let (id, panic, threshold) = (w.agents[i].id.clone(), w.agents[i].panic, w.agents[i].threshold);
        let wallet = w.bank.acct(&id).wallet;
        if wallet > 0 && panic < threshold {
            let share = 600 + w.rng.int(400) as u128;
            let _ = w.bank.deposit(&id, wallet * share / 1000);
        }
    }
}

pub fn create_world(seed: u32) -> World {
    let mut rng = Rng(if seed == 0 { 1 } else { seed });
    let agents = create_agents(&mut rng);
    let genesis: Vec<(String, u128)> = agents.iter().map(|a| (a.id.clone(), 500 + rng.int(4501) as u128)).collect();
    let bank = Bank::new(DAO_ID, CHAIR_ID, &genesis);
    let mut w = World { rng, bank, agents, credibility: CRED_START, last_outflow_permille: 0, last_writedown_permille: 0 };
    open_round(&mut w);
    w
}

fn reserve_permille(b: &Bank) -> i64 {
    b.reserve_ratio() as i64
}

fn has_shares(b: &Bank, id: &str) -> bool {
    b.accounts.get(id).is_some_and(|a| a.shares > 0)
}

pub struct Step {
    pub rejected: Option<String>,
    pub ran: u32,
    pub avg_panic: i64,
}

/// One epoch with the human's decision (`stepEpoch` with a decision; the bank is open).
fn step_epoch(w: &mut World, rumor: Option<&str>, d: &Policy, news: &[News]) -> Step {
    if let Some(kind) = rumor { let _ = w.bank.rumor(NPC, kind); }
    let before = w.bank.policy.clone();
    let rumors = w.bank.rumors.iter().filter(|r| r.epoch_id == w.bank.epoch_id).count();
    let rejected = w.bank.set_policy(CHAIR_ID, d.clone()).err();
    let b = &w.bank;
    let pol = b.policy.clone();
    let cash_only: Vec<bool> = w.agents.iter().map(|a| !has_shares(b, &a.id)).collect();
    let sig = Signals {
        epoch_id: b.epoch_id as i64,
        tone: &d.tone,
        credibility: w.credibility,
        rate_change: pol.rate as i64 - before.rate as i64,
        gate_on: pol.gate > 0,
        gate_just_on: pol.gate > 0 && before.gate == 0,
        minted: rejected.is_none() && d.mint > 0,
        target_raised: pol.target > before.target,
        outflow_permille: w.last_outflow_permille,
        reserve_permille: reserve_permille(b),
        rumors,
        writedown_permille: w.last_writedown_permille,
        cash_only,
        news,
    };
    update_panic(&mut w.agents, &sig, &mut w.rng);

    let mut ran = 0;
    let epoch_id = w.bank.epoch_id as i64;
    for i in act_order(&mut w.rng, w.agents.len()) {
        if w.bank.collapsed { break; }
        let id = w.agents[i].id.clone();
        let (wallet, shares) = { let a = w.bank.acct(&id); (a.wallet, a.shares) };
        let choice = decide(&w.agents[i], pol.rate, wallet > 0, shares > 0);
        if choice != Choice::Run && shares > 0 && w.rng.chance(LIFE_EVENT_PERMILLE) {
            let share = (LIFE_SHARE_MIN + w.rng.int(LIFE_SHARE_MAX - LIFE_SHARE_MIN + 1)) as u128;
            let amt = w.bank.value_of(&id) * share / 1000;
            if amt > 0 { let _ = w.bank.withdraw(&id, amt); }
            continue;
        }
        match choice {
            Choice::Run => {
                if w.bank.withdraw_all(&id).is_ok() { w.agents[i].ran_at = epoch_id; ran += 1; }
            }
            Choice::Deposit => { let _ = w.bank.deposit(&id, wallet / 2); }
            Choice::Hold => {}
        }
    }
    // the TypeScript bank pays every account at the collapse
    w.bank.settle_all();

    let b = &w.bank;
    let liab = b.liabilities();
    let outflow = if liab + b.outflow == 0 { 0 } else { (b.outflow * 1000 / (liab + b.outflow)) as i64 };
    if (d.tone == "calm" || d.tone == "confident") && outflow > w.last_outflow_permille && outflow > CRED_LIE_OUTFLOW {
        w.credibility = CRED_FLOOR.max(w.credibility - CRED_LIE_PENALTY);
    } else {
        w.credibility = CRED_START.min(w.credibility + CRED_RECOVER);
    }
    w.last_outflow_permille = outflow;

    w.last_writedown_permille = 0;
    if !w.bank.collapsed {
        let shock = if w.rng.chance(SHOCK_CHANCE) { SHOCK_MIN + w.rng.int(SHOCK_MAX - SHOCK_MIN + 1) } else { 0 };
        let round = w.bank.round;
        w.bank.advance_epoch(shock as u128);
        w.last_writedown_permille = shock as i64;
        if w.bank.round != round {
            cool_down(&mut w.agents, ROUND_PANIC_KEEP);
            open_round(w);
        }
    }
    let sum: i64 = w.agents.iter().map(|a| a.panic).sum();
    Step { rejected, ran, avg_panic: js_round(sum as f64 / w.agents.len() as f64) }
}

// ------------------------------------------------------------------ the crisis (crisis.ts)

const BROKEN_PROMISE: i64 = 250;
const REFUSED_ORDER: i64 = 100;
const CANDID: i64 = 60;
const CANDID_CALM: f64 = -30.0;
const PROMISE_CALM: f64 = -45.0;
const BROKEN_PANIC: f64 = 90.0;
const REFUSED_PANIC: f64 = 40.0;
const DODGE_PANIC: f64 = 30.0;
const NEIGHBOUR_BANK_PANIC: f64 = 70.0;
const SUITCASES_PANIC: f64 = 45.0;
const IMPEACH_BELOW: i64 = 400;
const HYPER_PERMILLE: u128 = 120;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Promise { NoPrint, NoGate, NoLosses, RateStays }

#[derive(Clone, Copy)]
struct Answer { tone: &'static str, promise: Option<Promise>, candid: bool, dodge: bool }

const fn ans(tone: &'static str) -> Answer { Answer { tone, promise: None, candid: false, dodge: false } }
const fn candid(tone: &'static str) -> Answer { Answer { tone, promise: None, candid: true, dodge: false } }
const fn dodge(tone: &'static str) -> Answer { Answer { tone, promise: None, candid: false, dodge: true } }
const fn promise(tone: &'static str, p: Promise) -> Answer { Answer { tone, promise: Some(p), candid: false, dodge: false } }

/// The deck: for every card, what its three answers do (the words are in crisis.ts).
fn card(id: &str) -> [Answer; 3] {
    use Promise::*;
    match id {
        "broken" => [candid("cautious"), ans("confident"), dodge("cautious")],
        "rejected" => [ans("calm"), candid("cautious"), ans("alarming")],
        "writedown" => [promise("calm", NoLosses), candid("cautious"), dodge("cautious")],
        "rumor_vault_empty" => [candid("confident"), promise("calm", NoGate), dodge("cautious")],
        "rumor_chair_resigning" => [candid("cautious"), promise("confident", RateStays), dodge("alarming")],
        "rumor_bailout_coming" => [promise("calm", NoPrint), candid("cautious"), ans("confident")],
        "grapefruit" => [candid("cautious"), promise("calm", NoGate), ans("alarming")],
        "suitcases" => [promise("calm", NoLosses), dodge("cautious"), candid("cautious")],
        "outflow" => [candid("cautious"), promise("calm", NoPrint), ans("alarming")],
        "lowvault" => [promise("confident", NoGate), candid("cautious"), dodge("cautious")],
        "gate" => [ans("alarming"), candid("cautious"), promise("confident", RateStays)],
        "printed" => [promise("calm", NoPrint), candid("cautious"), ans("confident")],
        "distrust" => [ans("confident"), candid("cautious"), dodge("cautious")],
        "opening" => [promise("calm", NoPrint), candid("cautious"), ans("confident")],
        "q_rate" => [promise("calm", RateStays), candid("cautious"), ans("alarming")],
        "q_loans" => [dodge("cautious"), promise("calm", NoLosses), candid("cautious")],
        "q_print" => [candid("cautious"), promise("calm", NoPrint), dodge("cautious")],
        "q_ai" => [ans("confident"), dodge("cautious"), candid("cautious")],
        "final" => [ans("confident"), candid("cautious"), ans("calm")],
        _ => panic!("unknown card {id}"),
    }
}

const QUIET: [&str; 4] = ["q_rate", "q_loans", "q_print", "q_ai"];
const RUMORS: [&str; 3] = ["vault_empty", "chair_resigning", "bailout_coming"];

#[derive(Clone, Debug, PartialEq, Eq)]
enum Scheduled { Rumor(&'static str), News(&'static str) }

fn schedule(rng: &mut Rng) -> Vec<(u32, Scheduled)> {
    let mut kinds: Vec<Scheduled> = RUMORS.iter().map(|k| Scheduled::Rumor(k)).collect();
    kinds.push(Scheduled::News("grapefruit"));
    kinds.push(Scheduled::News("suitcases"));
    // a JavaScript Set keeps insertion order; the epochs are sorted afterwards anyway
    let mut epochs: Vec<u32> = vec![rng.int(2)];
    while epochs.len() < 3 {
        let e = 1 + rng.int(7);
        if !epochs.contains(&e) { epochs.push(e); }
    }
    epochs.sort_unstable();
    epochs.into_iter().map(|e| { let k = rng.int(kinds.len() as u32) as usize; (e, kinds.remove(k)) }).collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lever { None, Rate, Target, Mint, Gate }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Move { pub a: u8, pub lever: Lever, pub v: u128 }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ending { Survived, Run, Impeached, Hyperinflation }

impl Ending {
    pub fn as_str(&self) -> &'static str {
        match self { Ending::Survived => "survived", Ending::Run => "run", Ending::Impeached => "impeached", Ending::Hyperinflation => "hyperinflation" }
    }
}

/// One day of a crisis, for the parity test.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Day {
    pub card: &'static str,
    pub rejected: bool,
    pub ran: u32,
    pub avg_panic: i64,
    pub reserve_permille: i64,
    pub credibility: i64,
    pub collapsed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrisisResult {
    pub ending: Ending,
    pub epochs: u32,
    pub score: u8,
    pub kept: u32,
    pub of: u32,
    pub credibility: i64,
    pub printed_permille: i64,
    pub days: Vec<Day>,
}

struct PromiseRec { kind: Promise, broken: bool }

pub struct Crisis {
    w: World,
    rng: Rng,
    schedule: Vec<(u32, Scheduled)>,
    promises: Vec<PromiseRec>,
    pending: Vec<News>,
    broken_last: bool,
    rejected_last: bool,
    used: Vec<&'static str>,
    card: &'static str,
    runners: Vec<usize>,
    minted: u128,
    supply0: u128,
    depositors0: u32,
    ending: Option<Ending>,
    days: Vec<Day>,
}

fn card_id(id: &str) -> &'static str {
    const ALL: [&str; 19] = ["broken", "rejected", "writedown", "rumor_vault_empty", "rumor_chair_resigning", "rumor_bailout_coming",
        "grapefruit", "suitcases", "outflow", "lowvault", "gate", "printed", "distrust", "opening", "q_rate", "q_loans", "q_print", "q_ai", "final"];
    ALL.iter().find(|x| **x == id).copied().unwrap_or_else(|| panic!("unknown card {id}"))
}

impl Crisis {
    pub fn new(seed: u32) -> Self {
        let mut w = create_world(seed);
        let _ = w.bank.airdrop(NPC); // the press pays for its rumours like everyone else
        let s = seed.wrapping_mul(0x9e37_79b1) ^ 0x5bd1_e995;
        let mut rng = Rng(if s == 0 { 1 } else { s });
        let schedule = schedule(&mut rng);
        let depositors0 = w.agents.iter().filter(|a| has_shares(&w.bank, &a.id)).count() as u32;
        let supply0 = w.bank.supply;
        let mut c = Crisis {
            w, rng, schedule, promises: vec![], pending: vec![], broken_last: false, rejected_last: false, used: vec![],
            card: "opening", runners: vec![], minted: 0, supply0, depositors0, ending: None, days: vec![],
        };
        c.card = c.deal();
        c
    }

    fn event_now(&self) -> Option<&Scheduled> {
        self.schedule.iter().find(|(e, _)| *e == self.w.bank.epoch).map(|(_, s)| s)
    }

    fn active(&self, k: Promise) -> bool {
        self.promises.iter().any(|p| p.kind == k && !p.broken)
    }

    fn deal(&mut self) -> &'static str {
        let w = &self.w;
        let b = &w.bank;
        let vault = reserve_permille(b);
        let once = |used: &Vec<&str>, id: &str| !used.contains(&id);
        let id: &'static str = if self.broken_last { "broken" }
            else if self.rejected_last { "rejected" }
            else if w.last_writedown_permille > 0 { "writedown" }
            else if let Some(Scheduled::Rumor(k)) = self.event_now() { card_id(&format!("rumor_{k}")) }
            else if let Some(Scheduled::News(n)) = self.event_now() { card_id(n) }
            else if b.epoch == 9 { "final" }
            else if w.last_outflow_permille > 80 && once(&self.used, "outflow") { "outflow" }
            else if vault < 120 && once(&self.used, "lowvault") { "lowvault" }
            else if b.policy.gate > 0 && once(&self.used, "gate") { "gate" }
            else if self.minted > 0 && once(&self.used, "printed") { "printed" }
            else if w.credibility < 600 && once(&self.used, "distrust") { "distrust" }
            else if b.epoch == 0 { "opening" }
            else {
                let left: Vec<&'static str> = QUIET.iter().copied().filter(|q| once(&self.used, q)).collect();
                let pool = if left.is_empty() { QUIET.to_vec() } else { left };
                pool[self.rng.int(pool.len() as u32) as usize]
            };
        if !self.used.contains(&id) { self.used.push(id); }
        id
    }

    fn hit(&mut self, by: i64) {
        self.w.credibility = 100.max(self.w.credibility - by);
    }

    fn break_promise(&mut self, k: Promise, into_pending: bool, news: &mut Vec<News>) {
        let Some(p) = self.promises.iter_mut().find(|p| p.kind == k && !p.broken) else { return };
        p.broken = true;
        self.hit(BROKEN_PROMISE);
        let n = News { delta: BROKEN_PANIC, by: None };
        if into_pending { self.pending.push(n); } else { news.push(n); }
    }

    /// The policy a move asks for: the current policy with one lever moved.
    fn decision(&self, m: &Move) -> Policy {
        let pol = &self.w.bank.policy;
        let tone = card(self.card)[m.a as usize].tone;
        Policy {
            rate: if m.lever == Lever::Rate { m.v } else { pol.rate },
            target: if m.lever == Lever::Target { m.v } else { pol.target },
            mint: if m.lever == Lever::Mint { m.v } else { 0 },
            gate: if m.lever == Lever::Gate { m.v } else { pol.gate },
            tone: tone.into(),
            statement: String::new(),
            attestation: String::new(),
        }
    }

    pub fn play(&mut self, m: &Move) {
        assert!(self.ending.is_none(), "the crisis is over");
        assert!(m.a <= 2, "an answer is 0, 1 or 2");
        let epoch = self.w.bank.epoch;
        let round = self.w.bank.round;
        let dealt = self.card;
        let (rumor, ev_news): (Option<&'static str>, Vec<News>) = match self.event_now() {
            Some(Scheduled::Rumor(k)) => (Some(*k), vec![]),
            Some(Scheduled::News("grapefruit")) => (None, vec![News { delta: NEIGHBOUR_BANK_PANIC, by: Some(Trait::Gullibility) }]),
            Some(Scheduled::News(_)) => (None, vec![News { delta: SUITCASES_PANIC, by: None }]),
            None => (None, vec![]),
        };
        let mut news: Vec<News> = std::mem::take(&mut self.pending);
        news.extend(ev_news);
        let mut broken: Vec<Promise> = vec![];
        let a = card(dealt)[m.a as usize];
        let before = self.w.bank.policy.clone();
        let d = self.decision(m);
        let pre_rejected = self.w.bank.check_policy(CHAIR_ID, &d).is_err();
        if a.candid {
            self.w.credibility = CRED_START.min(self.w.credibility + CANDID);
            news.push(News { delta: CANDID_CALM * self.w.credibility as f64 / 1000.0, by: None });
        }
        if let Some(p) = a.promise {
            if !self.active(p) {
                self.promises.push(PromiseRec { kind: p, broken: false });
                news.push(News { delta: PROMISE_CALM * self.w.credibility as f64 / 1000.0, by: Some(Trait::Trust) });
            }
        }
        if a.dodge { news.push(News { delta: DODGE_PANIC, by: None }); }
        if pre_rejected {
            self.hit(REFUSED_ORDER);
            news.push(News { delta: REFUSED_PANIC, by: None });
        } else {
            if d.mint > 0 && self.active(Promise::NoPrint) { broken.push(Promise::NoPrint); }
            if d.gate > 0 && before.gate == 0 && self.active(Promise::NoGate) { broken.push(Promise::NoGate); }
            if d.rate < before.rate && self.active(Promise::RateStays) { broken.push(Promise::RateStays); }
        }
        for k in broken.clone() { self.break_promise(k, false, &mut news); }

        let step_id = self.w.bank.epoch_id as i64;
        let step = step_epoch(&mut self.w, rumor, &d, &news);
        for (i, ag) in self.w.agents.iter().enumerate() {
            if ag.ran_at == step_id && !self.runners.contains(&i) { self.runners.push(i); }
        }
        if step.rejected.is_none() { self.minted += d.mint; }
        // crisis.ts: `press.rejected ?? rejected`, so an order the pre-check refused stays refused in the report
        let rejected = step.rejected.is_some() || pre_rejected;

        self.broken_last = !broken.is_empty();
        if self.w.last_writedown_permille > 0 && self.active(Promise::NoLosses) {
            let mut sink = vec![];
            self.break_promise(Promise::NoLosses, true, &mut sink);
            self.broken_last = true;
        }
        self.rejected_last = rejected;

        let b = &self.w.bank;
        self.ending = if b.collapsed { Some(Ending::Run) }
            else if b.round != round { Some(Ending::Survived) }
            else if self.w.credibility < IMPEACH_BELOW { Some(Ending::Impeached) }
            else if self.minted * 1000 >= self.supply0 * HYPER_PERMILLE { Some(Ending::Hyperinflation) }
            else { None };
        let _ = epoch;
        self.days.push(Day {
            card: dealt, rejected, ran: step.ran, avg_panic: step.avg_panic, reserve_permille: reserve_permille(b),
            credibility: self.w.credibility, collapsed: b.collapsed,
        });
        if self.ending.is_none() { self.card = self.deal(); }
    }

    pub fn ended(&self) -> bool {
        self.ending.is_some()
    }

    pub fn result(&self) -> Option<CrisisResult> {
        let ending = self.ending?;
        let of = self.depositors0.max(1);
        let kept = of - of.min(self.runners.len() as u32);
        let cred = self.days.last().map(|d| d.credibility).unwrap_or(CRED_START);
        let printed = js_round(self.minted as f64 * 1000.0 / self.supply0 as f64);
        let mult = match ending { Ending::Survived => 1.0, Ending::Impeached => 0.5, Ending::Hyperinflation => 0.35, Ending::Run => 0.25 };
        let base = 100.0 * (kept as f64 / of as f64) * (1.0 - 0.6 + 0.6 * cred as f64 / 1000.0) - 1.5 * printed as f64 / 10.0;
        let score = js_round(base * mult).clamp(0, 100) as u8;
        Some(CrisisResult { ending, epochs: self.days.len() as u32, score, kept, of, credibility: cred, printed_permille: printed, days: self.days.clone() })
    }
}

/// Moves from their link form: one to ten "answer lever value" triples joined by dots, e.g. "0n0.1r90.2m4000".
pub fn decode_moves(s: &str) -> Option<Vec<Move>> {
    let mut out = vec![];
    for part in s.split('.').filter(|p| !p.is_empty()) {
        let b = part.as_bytes();
        if !(3..=11).contains(&b.len()) || !b[2..].iter().all(u8::is_ascii_digit) { return None; }
        let a = match b[0] { b'0' => 0, b'1' => 1, b'2' => 2, _ => return None };
        let lever = match b[1] { b'n' => Lever::None, b'r' => Lever::Rate, b't' => Lever::Target, b'm' => Lever::Mint, b'g' => Lever::Gate, _ => return None };
        let v: u128 = part[2..].parse().ok()?;
        out.push(Move { a, lever, v });
    }
    if out.len() > 10 { None } else { Some(out) }
}

/// Moves in their link form (`encodeMoves` in crisis.ts).
pub fn encode_moves(moves: &[Move]) -> String {
    moves.iter().map(|m| {
        let l = match m.lever { Lever::None => 'n', Lever::Rate => 'r', Lever::Target => 't', Lever::Mint => 'm', Lever::Gate => 'g' };
        format!("{}{}{}", m.a, l, m.v)
    }).collect::<Vec<_>>().join(".")
}

/// Replay a crisis from its seed and moves (moves past the ending are ignored). None if the moves end too soon.
pub fn replay(seed: u32, moves: &[Move]) -> Option<CrisisResult> {
    let mut c = Crisis::new(seed);
    for m in moves {
        if c.ended() { break; }
        c.play(m);
    }
    c.result()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_round_matches_javascript() {
        assert_eq!(js_round(2.5), 3);
        assert_eq!(js_round(-2.5), -2);
        assert_eq!(js_round(-2.6), -3);
        assert_eq!(js_round(0.49999999999999994), 0);
        assert_eq!(js_round(-0.4), 0);
    }

}
