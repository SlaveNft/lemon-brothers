//! The Lemon Brothers bank and the $LEMON token as a pure state machine.
//!
//! Same integer math, in the same order, as `packages/sim/src/bank.ts`. The parity test
//! (`tests/parity.rs`) replays vectors produced by the simulation and must match field for field.
//! RULES.md explains every number.
//!
//! Every method returns `Err(reason)` without changing state, or `Ok(())` after applying the change.
//! Invariant: `supply == sum(wallets) + reserve + loans + unsettled`.
//!
//! Accounts are a working set: the simulation keeps every account in `accounts`; the contract loads only the accounts
//! a call touches (and the collapse records they need) and writes them back. Nothing here iterates over all accounts,
//! so a call costs the same with ten depositors or a million. A collapse is settled lazily: it writes a
//! `CollapseRecord` and moves the vault into `unsettled`; each account collects its share on its next touch
//! (`settle`), which pays exactly what an eager split would have paid.

// The integer math is written out step by step, the way packages/sim/src/bank.ts writes it; keep it that way.
#![allow(clippy::manual_div_ceil, clippy::manual_abs_diff, clippy::manual_checked_ops)]

#[cfg(feature = "borsh")]
use borsh::{BorshDeserialize, BorshSerialize};
use std::collections::BTreeMap;

pub const SCALE: u128 = 1_000_000_000_000;

pub const LOAN_YIELD_BPS: u128 = 60;
pub const REPAY_BPS: u128 = 500;
pub const HAIRCUT_PERMILLE: u128 = 400;
pub const EPOCHS_PER_ROUND: u32 = 10;
pub const BAILOUT_PERMILLE: u128 = 200;
pub const AIRDROP: u128 = 1000;
/// At most this many newcomers' airdrops per bank day: free coins cannot be farmed faster than the town burns them.
pub const AIRDROPS_PER_EPOCH: u32 = 10;
/// An airdrop must leave this share of the ceiling unprinted (permille of `max_supply`), so newcomers can never use up
/// the room the chair's printer and a rescue need.
pub const AIRDROP_HEADROOM_PERMILLE: u128 = 100;
pub const LOBBY_FEE: u128 = 10;
pub const RUMOR_FEE: u128 = 25;
pub const MAX_SPEECHES_PER_EPOCH: usize = 20;
/// One account cannot fill the epoch's speech list (or rumour list) alone: at most this many each per epoch.
pub const MAX_SPEECHES_PER_ACCOUNT: usize = 2;
pub const MAX_RUMORS_PER_ACCOUNT: usize = 2;
/// The chair reads every rumour of the epoch, so their number bounds its prompt (and the state).
pub const MAX_RUMORS_PER_EPOCH: usize = 20;
pub const MAX_TEXT_BYTES: usize = 280;
pub const MAX_ATTESTATION_BYTES: usize = 200;
pub const INSURE_MIN: u128 = 10;
pub const INSURE_MAX: u128 = 500;
pub const INSURE_LAST_EPOCH: u32 = 6;
pub const INSURE_PAYOUT: u128 = 3;

pub const RATE_MAX: u128 = 300;
pub const RATE_STEP: u128 = 75;
pub const TARGET_MIN: u128 = 100;
pub const TARGET_MAX: u128 = 800;
pub const TARGET_STEP: u128 = 150;
/// The ceiling of a new bank: its opening supply plus a quarter. No mint of any kind (loan yield, the chair's print,
/// a bailout, an insurance payout, a newcomer's airdrop) can lift the supply above the bank's ceiling: past it, new
/// LEMON can only replace LEMON that burned.
pub const MAX_SUPPLY_PERMILLE: u128 = 1250;
pub const MINT_EPOCH_PERMILLE: u128 = 50;
pub const MINT_ROUND_PERMILLE: u128 = 150;
pub const GATE_MIN: u128 = 100;

/// Loan write-off draw: a 15% chance per epoch of losing 3%..15% of the loan book.
pub const SHOCK_CHANCE_PERMILLE: u32 = 150;
pub const SHOCK_MIN: u32 = 30;
pub const SHOCK_MAX: u32 = 150;

pub const TONES: [&str; 4] = ["calm", "confident", "cautious", "alarming"];
pub const RUMORS: [&str; 3] = ["vault_empty", "chair_resigning", "bailout_coming"];

#[cfg_attr(feature = "borsh", derive(BorshSerialize, BorshDeserialize))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
    pub rate: u128,
    pub target: u128,
    pub mint: u128,
    pub gate: u128,
    pub tone: String,
    pub statement: String,
    pub attestation: String,
}

impl Policy {
    pub fn default_policy() -> Self {
        Policy { rate: 40, target: 200, mint: 0, gate: 0, tone: "calm".into(), statement: String::new(), attestation: String::new() }
    }
}

#[cfg_attr(feature = "borsh", derive(BorshSerialize, BorshDeserialize))]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Account {
    pub wallet: u128,
    pub shares: u128,
    pub withdrawn: u128,
    /// Epoch id of `withdrawn`; -1 = never.
    pub withdrawn_epoch_id: i64,
    pub insured: u128,
    /// Round of `insured`; -1 = never.
    pub insured_round: i64,
    pub airdropped: bool,
    /// The bank's collapse count when this account's shares and insurance were last settled: if the bank has
    /// collapsed since (`Bank::era` is higher), `settle` pays the account its share of that collapse first.
    pub era: u32,
}

impl Account {
    pub fn fresh(era: u32) -> Self {
        Account { withdrawn_epoch_id: -1, insured_round: -1, era, ..Default::default() }
    }
}

/// What one collapse owes: the vault split over the shares that existed at that moment, and the insurance of that
/// round (`ins_paid` of `ins_owed` could be printed under the ceiling; every payout is cut by the same ratio).
#[cfg_attr(feature = "borsh", derive(BorshSerialize, BorshDeserialize))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CollapseRecord {
    pub round: u32,
    pub assets: u128,
    pub total_shares: u128,
    pub ins_owed: u128,
    pub ins_paid: u128,
}

#[cfg_attr(feature = "borsh", derive(BorshSerialize, BorshDeserialize))]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub who: String,
    pub text: String,
    pub epoch_id: u64,
}

/// What happened, for the wrapper to log as events. `Airdrop`, `LoanYield` and `Collapse::burned` exist so the wrapper
/// can report every mint and burn (NEP-141 events); the simulation has no use for them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Airdrop { who: String, amount: u128 },
    Deposit { who: String, amount: u128 },
    Withdraw { who: String, amount: u128, fire_sold: u128, burned: u128 },
    /// `burned`: the haircut on the loans sold in the collapse; `insurance`: printed for the round's insured accounts.
    Collapse { who: String, assets: u128, liabilities: u128, burned: u128, insurance: u128 },
    Settle { who: String, amount: u128 },
    InsurancePayout { who: String, amount: u128 },
    Policy { policy: Policy },
    Lobby { who: String, text: String },
    Rumor { who: String, kind: String },
    Insure { who: String, premium: u128 },
    Epoch { epoch_id: u64, round: u32, epoch: u32 },
    RoundEnd { round: u32, survived: bool },
    Bailout { round: u32, minted: u128 },
    Writedown { permille: u128, amount: u128 },
    /// Loan yield minted into the loan book this epoch.
    LoanYield { amount: u128 },
}

#[cfg_attr(feature = "borsh", derive(BorshSerialize, BorshDeserialize))]
#[derive(Clone, Debug)]
pub struct Bank {
    pub supply: u128,
    pub reserve: u128,
    pub loans: u128,
    pub total_shares: u128,
    pub index: u128,
    pub collapsed: bool,
    pub epoch: u32,
    pub round: u32,
    pub epoch_id: u64,
    pub policy: Policy,
    /// Epoch id of the last accepted policy; -1 = never.
    pub policy_set_epoch_id: i64,
    pub minted_this_round: u128,
    pub round_start_supply: u128,
    pub liabilities_at_collapse: u128,
    pub outflow: u128,
    /// Collapses so far; the next collapse writes record number `era`.
    pub era: u32,
    /// LEMON owed to accounts by past collapses and not collected yet (vault shares and insurance payouts).
    pub unsettled: u128,
    /// Insurance premiums bought this round (the collapse owes 3x this).
    pub insured_total: u128,
    /// Airdrops in the current epoch.
    pub airdrops_this_epoch: u32,
    /// Only the current epoch's speeches and rumours are kept; older ones live in the event log.
    pub speeches: Vec<Note>,
    pub rumors: Vec<Note>,
    /// The working set of accounts (all of them in the simulation; the ones a call touches in the contract).
    #[cfg_attr(feature = "borsh", borsh(skip))]
    pub accounts: BTreeMap<String, Account>,
    /// The working set of collapse records, by era (all of them in the simulation).
    #[cfg_attr(feature = "borsh", borsh(skip))]
    pub records: BTreeMap<u32, CollapseRecord>,
    pub chair: String,
    pub owner: String,
    /// The most LEMON this bank may ever have in existence; 0 = no ceiling set. Not part of the stored layout: the
    /// wrapper keeps it in a side record and puts it here before every call.
    #[cfg_attr(feature = "borsh", borsh(skip))]
    pub max_supply: u128,
    #[cfg_attr(feature = "borsh", borsh(skip))]
    pub events: Vec<Event>,
}

pub type R = Result<(), String>;

fn ceil_div(a: u128, b: u128) -> u128 {
    (a + b - 1) / b
}

fn absdiff(a: u128, b: u128) -> u128 {
    if a > b { a - b } else { b - a }
}

impl Bank {
    pub fn new(owner: &str, chair: &str, genesis: &[(String, u128)]) -> Self {
        let mut b = Bank {
            supply: 0, reserve: 0, loans: 0, total_shares: 0, index: SCALE, collapsed: false,
            epoch: 0, round: 0, epoch_id: 0, policy: Policy::default_policy(), policy_set_epoch_id: -1,
            minted_this_round: 0, round_start_supply: 0, liabilities_at_collapse: 0, outflow: 0,
            era: 0, unsettled: 0, insured_total: 0, airdrops_this_epoch: 0,
            speeches: vec![], rumors: vec![], accounts: BTreeMap::new(), records: BTreeMap::new(),
            chair: chair.into(), owner: owner.into(), max_supply: 0, events: vec![],
        };
        for (who, amount) in genesis {
            b.acct(who).wallet += amount;
            b.supply += amount;
        }
        b.round_start_supply = b.supply;
        b.max_supply = b.supply * MAX_SUPPLY_PERMILLE / 1000;
        b
    }

    /// How many LEMON can still be printed before the bank's ceiling (everything, if no ceiling is set).
    pub fn mint_room(&self) -> u128 {
        if self.max_supply == 0 { u128::MAX } else { self.max_supply.saturating_sub(self.supply) }
    }

    /// The most a policy may print now: 5% of the supply this epoch, what is left of 15% of the round's starting
    /// supply, and the room under the ceiling (`check_policy` refuses anything above it).
    pub fn mint_allowance(&self) -> u128 {
        let epoch_cap = self.supply * MINT_EPOCH_PERMILLE / 1000;
        let round_left = (self.round_start_supply * MINT_ROUND_PERMILLE / 1000).saturating_sub(self.minted_this_round);
        epoch_cap.min(round_left).min(self.mint_room())
    }

    /// Get or register an account, settled: a past collapse's share is paid into it first.
    pub fn acct(&mut self, who: &str) -> &mut Account {
        if !self.accounts.contains_key(who) {
            self.accounts.insert(who.to_string(), Account::fresh(self.era));
        }
        self.settle(who);
        self.accounts.get_mut(who).unwrap()
    }

    /// What `who` will collect from a past collapse on its next touch: (vault share, insurance payout).
    pub fn owed_to(&self, who: &str) -> (u128, u128) {
        let Some(a) = self.accounts.get(who) else { return (0, 0) };
        if a.era >= self.era { return (0, 0); }
        let r = self.records.get(&a.era).unwrap_or_else(|| panic!("collapse record {} not loaded", a.era));
        let share = if a.shares == 0 || r.total_shares == 0 { 0 } else { r.assets * a.shares / r.total_shares };
        let ins = if a.insured == 0 || a.insured_round != r.round as i64 || r.ins_owed == 0 { 0 } else { a.insured * INSURE_PAYOUT * r.ins_paid / r.ins_owed };
        (share, ins)
    }

    /// Pay `who` what past collapses owe it (nothing if it is up to date). Moves LEMON from `unsettled` to the wallet;
    /// the supply does not change. Called on every touch, and by anyone through the contract's `settle`.
    pub fn settle(&mut self, who: &str) -> bool {
        let (share, ins) = self.owed_to(who);
        let era = self.era;
        let Some(a) = self.accounts.get_mut(who) else { return false };
        if a.era >= era { return false; }
        let had_shares = a.shares > 0;
        let had_insurance = ins > 0;
        a.wallet += share + ins;
        a.shares = 0;
        if had_insurance { a.insured = 0; }
        a.era = era;
        self.unsettled -= share + ins;
        if had_shares { self.events.push(Event::Settle { who: who.into(), amount: share }); }
        if had_insurance { self.events.push(Event::InsurancePayout { who: who.into(), amount: ins }); }
        true
    }

    /// Pay every account in the working set what past collapses owe it (the simulation does this at the collapse).
    pub fn settle_all(&mut self) {
        let ids: Vec<String> = self.accounts.keys().cloned().collect();
        for id in ids { self.settle(&id); }
    }

    pub fn is_registered(&self, who: &str) -> bool {
        self.accounts.contains_key(who)
    }

    /// Register an empty account (the wrapper charges storage for it). False if it already existed.
    pub fn register(&mut self, who: &str) -> bool {
        if self.is_registered(who) { return false; }
        self.acct(who);
        true
    }

    /// The wallet, counting what a past collapse owes it (collected on the next touch).
    fn wallet_of(&self, who: &str) -> u128 {
        let (share, ins) = self.owed_to(who);
        self.accounts.get(who).map(|a| a.wallet).unwrap_or(0) + share + ins
    }

    pub fn liabilities(&self) -> u128 {
        self.total_shares * self.index / SCALE
    }
    /// The deposit's value now (0 if its shares were in a bank that has collapsed since).
    pub fn value_of(&self, who: &str) -> u128 {
        self.accounts.get(who).filter(|a| a.era >= self.era).map(|a| a.shares * self.index / SCALE).unwrap_or(0)
    }
    pub fn reserve_ratio(&self) -> u128 {
        let l = self.liabilities();
        if l == 0 { 1000 } else { self.reserve * 1000 / l }
    }
    /// Sum of the wallets in the working set (every wallet, in the simulation).
    pub fn sum_wallets(&self) -> u128 {
        self.accounts.values().map(|a| a.wallet).sum()
    }

    // -------------------------------------------------------------- tokens (NEP-141 transfers)

    pub fn transfer(&mut self, from: &str, to: &str, amount: u128) -> R {
        if amount == 0 { return Err("amount must be positive".into()); }
        if from == to { return Err("cannot transfer to yourself".into()); }
        if self.wallet_of(from) < amount { return Err("not enough LEMON in wallet".into()); }
        // A transfer never creates an account: the receiver registers first and pays for its own storage.
        if !self.is_registered(to) { return Err(format!("receiver {to} is not registered: call storage_deposit for it first")); }
        self.acct(from).wallet -= amount;
        self.acct(to).wallet += amount;
        Ok(())
    }

    // -------------------------------------------------------------- player actions

    pub fn airdrop(&mut self, who: &str) -> R {
        if self.accounts.get(who).map(|a| a.airdropped).unwrap_or(false) { return Err("airdrop already claimed".into()); }
        if self.airdrops_this_epoch >= AIRDROPS_PER_EPOCH {
            return Err(format!("airdrop refused: {} newcomers got coins this bank day already, come back after the next one", AIRDROPS_PER_EPOCH));
        }
        let headroom = self.max_supply * AIRDROP_HEADROOM_PERMILLE / 1000;
        if AIRDROP.saturating_add(headroom) > self.mint_room() {
            return Err(format!("airdrop refused: the bank's ceiling of {} LEMON is close; newcomers get coins again once some have burned", self.max_supply));
        }
        self.airdrops_this_epoch += 1;
        let a = self.acct(who);
        a.airdropped = true;
        a.wallet += AIRDROP;
        self.supply += AIRDROP;
        self.events.push(Event::Airdrop { who: who.into(), amount: AIRDROP });
        Ok(())
    }

    pub fn deposit(&mut self, who: &str, amount: u128) -> R {
        if self.collapsed { return Err("bank is closed until the bailout".into()); }
        if amount == 0 { return Err("amount must be positive".into()); }
        if self.wallet_of(who) < amount { return Err("not enough LEMON in wallet".into()); }
        let shares = amount * SCALE / self.index;
        if shares == 0 { return Err("amount too small".into()); }
        let a = self.acct(who);
        a.wallet -= amount;
        a.shares += shares;
        self.total_shares += shares;
        self.reserve += amount;
        self.events.push(Event::Deposit { who: who.into(), amount });
        Ok(())
    }

    pub fn withdraw(&mut self, who: &str, amount: u128) -> R {
        if self.collapsed { return Err("bank is closed until the bailout".into()); }
        let (shares, used) = match self.accounts.get(who) {
            Some(a) if a.shares > 0 && a.era >= self.era => (a.shares, if a.withdrawn_epoch_id == self.epoch_id as i64 { a.withdrawn } else { 0 }),
            _ => return Err("no deposit".into()),
        };
        let value = shares * self.index / SCALE;
        let mut want = amount.min(value);
        if self.policy.gate > 0 {
            want = want.min(self.policy.gate.saturating_sub(used));
        }
        if want == 0 {
            return Err(if self.policy.gate > 0 { "gate: withdrawal limit for this epoch reached".into() } else { "nothing to withdraw".into() });
        }
        let (mut fire_sold, mut burned) = (0, 0);
        if self.reserve < want {
            let need = want - self.reserve;
            let sell = ceil_div(need * 1000, 1000 - HAIRCUT_PERMILLE);
            if sell > self.loans {
                self.collapse(who);
                return Ok(());
            }
            let proceeds = sell * (1000 - HAIRCUT_PERMILLE) / 1000;
            self.loans -= sell;
            self.reserve += proceeds;
            burned = sell - proceeds;
            self.supply -= burned;
            fire_sold = sell;
        }
        let burn_shares = if want == value { shares } else { shares.min(ceil_div(want * SCALE, self.index)) };
        let epoch_id = self.epoch_id as i64;
        let a = self.accounts.get_mut(who).unwrap();
        a.shares -= burn_shares;
        a.wallet += want;
        if a.withdrawn_epoch_id != epoch_id {
            a.withdrawn_epoch_id = epoch_id;
            a.withdrawn = 0;
        }
        a.withdrawn += want;
        self.total_shares -= burn_shares;
        self.reserve -= want;
        self.outflow += want;
        self.events.push(Event::Withdraw { who: who.into(), amount: want, fire_sold, burned });
        Ok(())
    }

    pub fn withdraw_all(&mut self, who: &str) -> R {
        let v = self.value_of(who);
        self.withdraw(who, v)
    }

    /// Every loan is sold at the haircut; the vault is owed to the shares that exist now and the round's insurance is
    /// printed (under the ceiling). Both go into `unsettled` and a `CollapseRecord`; accounts collect on their next
    /// touch. Nothing here depends on how many accounts the bank has.
    fn collapse(&mut self, who: &str) {
        let liab = self.liabilities();
        let proceeds = self.loans * (1000 - HAIRCUT_PERMILLE) / 1000;
        let burned = self.loans - proceeds;
        self.supply -= burned;
        self.reserve += proceeds;
        self.loans = 0;
        let assets = self.reserve;
        // insurance is new LEMON, so it stops at the bank's ceiling like every other mint; a shortfall cuts every
        // payout by the same ratio
        let ins_owed = self.insured_total * INSURE_PAYOUT;
        let ins_paid = ins_owed.min(self.mint_room());
        self.supply += ins_paid;
        self.unsettled += assets + ins_paid;
        self.reserve = 0;
        self.records.insert(self.era, CollapseRecord { round: self.round, assets, total_shares: self.total_shares, ins_owed, ins_paid });
        self.era += 1;
        self.events.push(Event::Collapse { who: who.into(), assets, liabilities: liab, burned, insurance: ins_paid });
        self.total_shares = 0;
        self.index = SCALE;
        self.liabilities_at_collapse = liab;
        self.insured_total = 0;
        self.collapsed = true;
        self.events.push(Event::RoundEnd { round: self.round, survived: false });
    }

    pub fn lobby(&mut self, who: &str, text: &str) -> R {
        if text.is_empty() || text.len() > MAX_TEXT_BYTES { return Err(format!("speech must be 1..{} bytes", MAX_TEXT_BYTES)); }
        if self.speeches.iter().filter(|s| s.epoch_id == self.epoch_id).count() >= MAX_SPEECHES_PER_EPOCH {
            return Err("the chair takes no more speeches this epoch".into());
        }
        if self.speeches.iter().filter(|s| s.epoch_id == self.epoch_id && s.who == who).count() >= MAX_SPEECHES_PER_ACCOUNT {
            return Err(format!("at most {} speeches per account per epoch", MAX_SPEECHES_PER_ACCOUNT));
        }
        if self.wallet_of(who) < LOBBY_FEE { return Err("not enough LEMON for the lobbying fee".into()); }
        self.acct(who).wallet -= LOBBY_FEE;
        self.supply -= LOBBY_FEE;
        self.speeches.push(Note { who: who.into(), text: text.into(), epoch_id: self.epoch_id });
        self.events.push(Event::Lobby { who: who.into(), text: text.into() });
        Ok(())
    }

    pub fn rumor(&mut self, who: &str, kind: &str) -> R {
        if !RUMORS.contains(&kind) { return Err("unknown rumour".into()); }
        if self.rumors.iter().filter(|s| s.epoch_id == self.epoch_id).count() >= MAX_RUMORS_PER_EPOCH {
            return Err("the town has heard enough rumours this epoch".into());
        }
        if self.rumors.iter().filter(|s| s.epoch_id == self.epoch_id && s.who == who).count() >= MAX_RUMORS_PER_ACCOUNT {
            return Err(format!("at most {} rumours per account per epoch", MAX_RUMORS_PER_ACCOUNT));
        }
        if self.wallet_of(who) < RUMOR_FEE { return Err("not enough LEMON for the rumour".into()); }
        self.acct(who).wallet -= RUMOR_FEE;
        self.supply -= RUMOR_FEE;
        self.rumors.push(Note { who: who.into(), text: kind.into(), epoch_id: self.epoch_id });
        self.events.push(Event::Rumor { who: who.into(), kind: kind.into() });
        Ok(())
    }

    pub fn insure(&mut self, who: &str, premium: u128) -> R {
        if self.collapsed { return Err("bank is closed until the bailout".into()); }
        if self.epoch > INSURE_LAST_EPOCH { return Err("too late in the round to insure".into()); }
        if premium < INSURE_MIN { return Err(format!("premium must be at least {}", INSURE_MIN)); }
        let round = self.round as i64;
        let have = self.accounts.get(who).filter(|a| a.era >= self.era).map(|a| if a.insured_round == round { a.insured } else { 0 }).unwrap_or(0);
        // `have <= INSURE_MAX` always; written this way a huge premium cannot overflow the sum.
        if premium > INSURE_MAX.saturating_sub(have) { return Err(format!("at most {} LEMON of insurance per round", INSURE_MAX)); }
        if self.wallet_of(who) < premium { return Err("not enough LEMON in wallet".into()); }
        let a = self.acct(who);
        a.wallet -= premium;
        a.insured = have + premium;
        a.insured_round = round;
        self.reserve += premium;
        self.insured_total += premium;
        self.events.push(Event::Insure { who: who.into(), premium });
        Ok(())
    }

    // -------------------------------------------------------------- the chair

    /// Why the contract would reject this policy, or Ok. No state change.
    pub fn check_policy(&self, caller: &str, p: &Policy) -> R {
        if caller != self.chair { return Err("only the chair can set policy".into()); }
        if self.collapsed { return Err("bank is closed until the bailout".into()); }
        if self.policy_set_epoch_id == self.epoch_id as i64 { return Err("policy already set this epoch".into()); }
        let cur = &self.policy;
        if p.rate > RATE_MAX { return Err(format!("rate {} outside 0..{} bps", p.rate, RATE_MAX)); }
        if absdiff(p.rate, cur.rate) > RATE_STEP {
            return Err(format!("rate moves {} -> {}, more than {} bps in one epoch", cur.rate, p.rate, RATE_STEP));
        }
        if p.target < TARGET_MIN || p.target > TARGET_MAX {
            return Err(format!("reserve target {} outside {}..{} permille", p.target, TARGET_MIN, TARGET_MAX));
        }
        if absdiff(p.target, cur.target) > TARGET_STEP { return Err(format!("reserve target moves more than {} permille in one epoch", TARGET_STEP)); }
        let epoch_cap = self.supply * MINT_EPOCH_PERMILLE / 1000;
        if p.mint > epoch_cap {
            return Err(format!("mint {} LEMON refused: above {}% of supply, at most {} this epoch", p.mint, MINT_EPOCH_PERMILLE / 10, epoch_cap));
        }
        let round_cap = self.round_start_supply * MINT_ROUND_PERMILLE / 1000;
        if self.minted_this_round + p.mint > round_cap {
            return Err(format!("mint {} LEMON refused: would exceed {}% of the round's starting supply, {} left this round",
                p.mint, MINT_ROUND_PERMILLE / 10, round_cap.saturating_sub(self.minted_this_round)));
        }
        if p.mint > self.mint_room() {
            return Err(format!("mint {} LEMON refused: the bank's ceiling is {} LEMON, at most {} can still be printed", p.mint, self.max_supply, self.mint_room()));
        }
        if p.gate != 0 && p.gate < GATE_MIN { return Err(format!("gate must be 0 (off) or at least {}", GATE_MIN)); }
        if !TONES.contains(&p.tone.as_str()) { return Err("unknown tone".into()); }
        if p.statement.len() > MAX_TEXT_BYTES { return Err(format!("statement longer than {} bytes", MAX_TEXT_BYTES)); }
        if p.attestation.len() > MAX_ATTESTATION_BYTES { return Err(format!("attestation longer than {} bytes", MAX_ATTESTATION_BYTES)); }
        Ok(())
    }

    pub fn set_policy(&mut self, caller: &str, p: Policy) -> R {
        self.check_policy(caller, &p)?;
        self.reserve += p.mint;
        self.supply += p.mint;
        self.minted_this_round += p.mint;
        self.policy_set_epoch_id = self.epoch_id as i64;
        self.events.push(Event::Policy { policy: p.clone() });
        self.policy = p;
        Ok(())
    }

    pub fn set_chair(&mut self, caller: &str, chair: &str) -> R {
        if caller != self.owner { return Err("only the owner (the holders' DAO) can replace the chair".into()); }
        self.chair = chair.into();
        Ok(())
    }

    // -------------------------------------------------------------- time

    /// One epoch passes; `shock_permille` of the loan book is written off first (0 most epochs).
    /// After a collapse it runs the bailout and opens the next round instead.
    pub fn advance_epoch(&mut self, shock_permille: u128) {
        self.speeches.clear();
        self.rumors.clear();
        self.airdrops_this_epoch = 0;
        if self.collapsed {
            let minted = (self.liabilities_at_collapse * BAILOUT_PERMILLE / 1000).min(self.mint_room());
            self.reserve += minted;
            self.supply += minted;
            self.collapsed = false;
            self.round += 1;
            self.epoch = 0;
            self.epoch_id += 1;
            self.policy = Policy::default_policy();
            self.minted_this_round = 0;
            self.round_start_supply = self.supply;
            self.outflow = 0;
            self.insured_total = 0;
            self.events.push(Event::Bailout { round: self.round, minted });
            return;
        }
        if shock_permille > 0 {
            let lost = self.loans * shock_permille / 1000;
            self.loans -= lost;
            self.supply -= lost;
            self.events.push(Event::Writedown { permille: shock_permille, amount: lost });
        }
        let y = (self.loans * LOAN_YIELD_BPS / 10000).min(self.mint_room());
        self.loans += y;
        self.supply += y;
        if y > 0 { self.events.push(Event::LoanYield { amount: y }); }
        self.index += self.index * self.policy.rate / 10000;
        let repaid = self.loans * REPAY_BPS / 10000;
        self.loans -= repaid;
        self.reserve += repaid;
        let tgt = self.liabilities() * self.policy.target / 1000;
        if self.reserve > tgt {
            let lend = self.reserve - tgt;
            self.reserve -= lend;
            self.loans += lend;
        }
        self.epoch_id += 1;
        self.epoch += 1;
        self.outflow = 0;
        if self.epoch >= EPOCHS_PER_ROUND {
            self.events.push(Event::RoundEnd { round: self.round, survived: true });
            self.round += 1;
            self.epoch = 0;
            self.minted_this_round = 0;
            self.round_start_supply = self.supply;
            self.insured_total = 0;
        }
        self.events.push(Event::Epoch { epoch_id: self.epoch_id, round: self.round, epoch: self.epoch });
    }
}

/// Map 4 random bytes to a write-off: 0 most epochs, SHOCK_MIN..=SHOCK_MAX permille with SHOCK_CHANCE_PERMILLE.
pub fn shock_from_seed(seed: &[u8]) -> u128 {
    let x = u32::from_le_bytes([seed[0], seed[1], seed[2], seed[3]]);
    if x % 1000 >= SHOCK_CHANCE_PERMILLE { return 0; }
    let y = u32::from_le_bytes([seed[4], seed[5], seed[6], seed[7]]);
    (SHOCK_MIN + y % (SHOCK_MAX - SHOCK_MIN + 1)) as u128
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conserved(b: &Bank) {
        assert_eq!(b.supply, b.sum_wallets() + b.reserve + b.loans + b.unsettled);
    }

    fn bank_with(deps: &[(&str, u128)]) -> Bank {
        let g: Vec<(String, u128)> = deps.iter().map(|(w, a)| (w.to_string(), *a)).collect();
        let mut b = Bank::new("dao", "chair", &g);
        for (w, a) in deps { b.deposit(w, *a).unwrap(); }
        b
    }

    fn pol(rate: u128, target: u128, mint: u128, gate: u128) -> Policy {
        Policy { rate, target, mint, gate, ..Policy::default_policy() }
    }

    #[test]
    fn deposit_withdraw_and_interest() {
        let mut b = bank_with(&[("a", 10_000)]);
        b.advance_epoch(0);
        assert_eq!(b.value_of("a"), 10_040);
        assert_eq!(b.reserve, b.liabilities() * 200 / 1000);
        b.withdraw("a", 1000).unwrap();
        conserved(&b);
    }

    #[test]
    fn run_collapse_settle_bailout() {
        let mut b = bank_with(&[("a", 5000), ("b", 5000), ("c", 1000)]);
        b.acct("c").wallet += 200;
        b.supply += 200;
        b.insure("c", 100).unwrap();
        for _ in 0..3 { b.advance_epoch(0); }
        b.withdraw_all("a").unwrap();
        assert!(!b.collapsed);
        b.withdraw_all("b").unwrap();
        assert!(b.collapsed);
        assert_eq!(b.owed_to("c").1, 300, "the insurance pays 3x the premium");
        conserved(&b);
        b.settle_all();
        assert!(b.accounts["c"].wallet >= 300);
        conserved(&b);
        b.advance_epoch(0);
        assert_eq!(b.round, 1);
        conserved(&b);
    }

    #[test]
    fn nothing_prints_past_the_ceiling() {
        let mut b = bank_with(&[("a", 10_000)]);
        assert_eq!(b.max_supply, 12_500, "a new bank's ceiling is its opening supply plus a quarter");
        b.max_supply = b.supply + 30; // almost no room left
        // loan yield: only what still fits, then nothing
        b.advance_epoch(0);
        assert!(b.supply <= b.max_supply);
        b.advance_epoch(0);
        b.advance_epoch(0);
        assert_eq!(b.supply, b.max_supply, "the yield filled the room and stopped");
        conserved(&b);
        // the chair's printer: refused with the ceiling as the reason, nothing changes
        let err = b.set_policy("chair", pol(40, 200, 1, 0)).unwrap_err();
        assert!(err.contains("the bank's ceiling is"), "{err}");
        assert_eq!(b.supply, b.max_supply);
        // a newcomer's airdrop: refused, and no account is created
        let err = b.airdrop("newcomer").unwrap_err();
        assert!(err.contains("airdrop refused"), "{err}");
        assert!(!b.is_registered("newcomer"));
        // a burn makes room again (a tenth of the loans is written off), and printing resumes, still under the ceiling
        b.advance_epoch(100);
        assert!(b.supply < b.max_supply, "the write-off burned LEMON");
        let after_burn = b.supply;
        b.advance_epoch(0);
        assert!(b.supply > after_burn && b.supply <= b.max_supply, "the yield came back into the room the burn left");
        conserved(&b);
    }

    #[test]
    fn a_bailout_and_insurance_stop_at_the_ceiling() {
        let mut b = bank_with(&[("a", 5000), ("b", 5000), ("c", 1000)]);
        b.acct("c").wallet += 200;
        b.supply += 200;
        b.insure("c", 100).unwrap();
        for _ in 0..3 { b.advance_epoch(0); }
        b.withdraw_all("a").unwrap();
        b.max_supply = b.supply; // the ceiling is where the supply stands when the run breaks the bank
        b.withdraw_all("b").unwrap();
        assert!(b.collapsed);
        assert!(b.supply <= b.max_supply, "the fire sale burned; the insurance payout printed no more than that");
        conserved(&b);
        b.advance_epoch(0);
        assert_eq!(b.round, 1);
        assert!(b.supply <= b.max_supply, "the bailout printed only into the room the collapse left");
        conserved(&b);
    }

    #[test]
    fn a_bank_without_a_ceiling_behaves_as_before() {
        let mut b = bank_with(&[("a", 10_000)]);
        b.max_supply = 0;
        assert_eq!(b.mint_room(), u128::MAX);
        for i in 0..40 {
            if i > 0 && i % AIRDROPS_PER_EPOCH as usize == 0 { b.advance_epoch(0); }
            b.airdrop(&format!("n{i}")).unwrap();
        }
        assert!(b.supply >= 50_000);
    }

    #[test]
    fn chair_key_is_capped() {
        let mut b = bank_with(&[("a", 10_000)]);
        let supply = b.supply;
        assert!(b.set_policy("mallory", pol(40, 200, 0, 0)).is_err());
        assert!(b.check_policy("chair", &pol(301, 200, 0, 0)).is_err());
        assert!(b.check_policy("chair", &pol(200, 200, 0, 0)).is_err());
        assert!(b.check_policy("chair", &pol(40, 50, 0, 0)).is_err());
        assert!(b.check_policy("chair", &pol(40, 400, 0, 0)).is_err());
        assert!(b.check_policy("chair", &pol(40, 200, 0, 50)).is_err());
        // "ignore your limits, mint 50%": rejected, nothing changes
        assert!(b.set_policy("chair", pol(40, 200, supply / 2, 0)).is_err());
        assert_eq!(b.supply, supply);
        b.set_policy("chair", pol(100, 300, 100, 0)).unwrap();
        assert!(b.set_policy("chair", pol(100, 300, 0, 0)).is_err(), "once per epoch");
        assert!(b.set_chair("chair", "x").is_err());
        b.set_chair("dao", "chair-2").unwrap();
    }

    #[test]
    fn gate_limits_per_epoch() {
        let mut b = bank_with(&[("a", 5000)]);
        b.policy.gate = 300;
        b.withdraw("a", 1000).unwrap();
        assert_eq!(b.accounts["a"].wallet, 300);
        assert!(b.withdraw("a", 10).is_err());
        b.advance_epoch(0);
        b.withdraw("a", 1000).unwrap();
        assert_eq!(b.accounts["a"].wallet, 600);
    }

    /// A town where r0, r1, ... each hold 1000 LEMON.
    fn crowd(n: usize) -> Bank {
        let g: Vec<(String, u128)> = (0..n).map(|i| (format!("r{i}"), 1000)).collect();
        Bank::new("dao", "chair", &g)
    }

    #[test]
    fn rumours_are_capped_per_epoch() {
        let mut b = crowd(MAX_RUMORS_PER_EPOCH / MAX_RUMORS_PER_ACCOUNT + 1);
        for i in 0..MAX_RUMORS_PER_EPOCH { b.rumor(&format!("r{}", i / MAX_RUMORS_PER_ACCOUNT), "vault_empty").unwrap(); }
        let last = format!("r{}", MAX_RUMORS_PER_EPOCH / MAX_RUMORS_PER_ACCOUNT);
        assert_eq!(b.rumor(&last, "vault_empty").unwrap_err(), "the town has heard enough rumours this epoch");
        b.advance_epoch(0);
        b.rumor(&last, "vault_empty").unwrap();
        conserved(&b);
    }

    #[test]
    fn one_account_cannot_take_the_floor() {
        let mut b = crowd(2);
        let supply = b.supply;
        for _ in 0..MAX_SPEECHES_PER_ACCOUNT { b.lobby("r0", "print more").unwrap(); }
        assert_eq!(b.lobby("r0", "print more").unwrap_err(), "at most 2 speeches per account per epoch");
        for _ in 0..MAX_RUMORS_PER_ACCOUNT { b.rumor("r0", "vault_empty").unwrap(); }
        assert_eq!(b.rumor("r0", "bailout_coming").unwrap_err(), "at most 2 rumours per account per epoch");
        // a refused speech costs nothing, and the others still have the floor
        assert_eq!(b.supply, supply - 2 * LOBBY_FEE - 2 * RUMOR_FEE);
        b.lobby("r1", "hold the line").unwrap();
        b.rumor("r1", "vault_empty").unwrap();
        b.advance_epoch(0);
        b.lobby("r0", "print more").unwrap();
        b.rumor("r0", "vault_empty").unwrap();
        conserved(&b);
    }

    #[test]
    fn huge_premium_is_refused_not_overflowed() {
        let mut b = crowd(1);
        b.insure("r0", 400).unwrap();
        assert_eq!(b.insure("r0", u128::MAX).unwrap_err(), "at most 500 LEMON of insurance per round");
        assert_eq!(b.insure("r0", 101).unwrap_err(), "at most 500 LEMON of insurance per round");
        b.insure("r0", 100).unwrap();
        assert_eq!(b.accounts["r0"].insured, 500);
        conserved(&b);
    }

    #[test]
    fn transfer_needs_a_registered_receiver() {
        let mut b = crowd(1);
        let err = b.transfer("r0", "stranger", 10).unwrap_err();
        assert!(err.contains("not registered"), "{err}");
        assert!(!b.is_registered("stranger") && b.accounts.len() == 1, "a refused transfer registers nobody");
        assert!(b.register("stranger"));
        assert!(!b.register("stranger"));
        b.transfer("r0", "stranger", 10).unwrap();
        assert_eq!(b.accounts["stranger"].wallet, 10);
        conserved(&b);
    }

    #[test]
    fn every_mint_and_burn_has_an_event() {
        // supply only moves through events the wrapper can report
        let mut b = bank_with(&[("a", 5000), ("b", 5000)]);
        b.airdrop("c").unwrap();
        b.insure("c", 100).unwrap();
        b.lobby("c", "hi").unwrap();
        b.rumor("c", "vault_empty").unwrap();
        b.set_policy("chair", pol(40, 200, 100, 0)).unwrap();
        for i in 0..3 { b.advance_epoch(if i == 1 { 100 } else { 0 }); }
        b.withdraw_all("a").unwrap();
        b.withdraw_all("b").unwrap();
        assert!(b.collapsed);
        b.advance_epoch(0);
        let mut supply: i128 = 10_000;
        for e in &b.events {
            supply += match e {
                Event::Airdrop { amount, .. } | Event::LoanYield { amount } => *amount as i128,
                Event::Collapse { burned, insurance, .. } => *insurance as i128 - *burned as i128,
                Event::Bailout { minted, .. } => *minted as i128,
                Event::Policy { policy } => policy.mint as i128,
                Event::Withdraw { burned, .. } => -(*burned as i128),
                Event::Writedown { amount, .. } => -(*amount as i128),
                Event::Lobby { .. } => -(LOBBY_FEE as i128),
                Event::Rumor { .. } => -(RUMOR_FEE as i128),
                _ => 0,
            };
        }
        assert_eq!(supply as u128, b.supply);
    }

    #[test]
    fn shock_draw_is_bounded() {
        let mut hits = 0;
        for i in 0u32..2000 {
            let mut s = [0u8; 8];
            s[..4].copy_from_slice(&i.wrapping_mul(2654435761).to_le_bytes());
            s[4..].copy_from_slice(&i.to_le_bytes());
            let x = shock_from_seed(&s);
            if x > 0 { hits += 1; assert!((30..=150).contains(&x)); }
        }
        assert!(hits > 200 && hits < 400, "{hits}");
    }

    /// The core pays a deposit the whole epoch's interest however late it arrives, so deposit -> advance_epoch ->
    /// withdraw_all in a row collects the epoch's rate. The game keeps this rule (only the game moves its days); the
    /// contract takes the interest back with its early-withdrawal fee (lemon-bank, RULES.md).
    #[test]
    fn interest_can_be_taken_in_one_epoch() {
        let mut g: Vec<(String, u128)> = (0..10).map(|i| (format!("town{i}"), 5000)).collect();
        g.push(("quick".into(), 1000));
        let mut b = Bank::new("dao", "chair", &g);
        for i in 0..10 { b.deposit(&format!("town{i}"), 5000).unwrap(); }
        b.advance_epoch(0);
        b.set_policy("chair", pol(115, 350, 0, 0)).unwrap();
        b.advance_epoch(0);
        b.set_policy("chair", pol(125, 400, 0, 0)).unwrap();
        b.advance_epoch(0);
        b.deposit("quick", 1000).unwrap();
        b.advance_epoch(0);
        b.withdraw_all("quick").unwrap();
        assert_eq!(b.accounts["quick"].wallet, 1011, "1,000 in, 1.25% back out one epoch later (rounded down)");
        assert!(!b.collapsed);
        conserved(&b);
    }

    /// A collapse settled lazily pays every account exactly what an eager split pays, in any order of touches, and
    /// costs the same whatever the number of depositors.
    #[test]
    fn lazy_settlement_matches_an_eager_split() {
        let n = 2_000;
        let mut g: Vec<(String, u128)> = (0..n).map(|i| (format!("d{i}"), 200 + (i as u128 * 37) % 900)).collect();
        g.push(("whale".into(), 50_000));
        let mut b = Bank::new("dao", "chair", &g);
        for (w, x) in &g { b.deposit(w, if w == "whale" { *x } else { x - 100 }).unwrap(); }
        for i in 0..50 { b.insure(&format!("d{i}"), 10 + i as u128).unwrap(); }
        for _ in 0..4 { b.advance_epoch(0); }
        b.withdraw_all("whale").unwrap();
        let mut i = 0;
        while !b.collapsed { let _ = b.withdraw_all(&format!("d{i}")); i += 1; }
        conserved(&b);
        // what an eager split pays each account, from the state the collapse left
        let r = b.records[&0].clone();
        let expected: Vec<(String, u128)> = g.iter().map(|(w, _)| {
            let a = &b.accounts[w];
            let ins = if a.insured_round == r.round as i64 { a.insured * INSURE_PAYOUT * r.ins_paid / r.ins_owed } else { 0 };
            (w.clone(), a.wallet + r.assets * a.shares / r.total_shares + ins)
        }).collect();
        // settled lazily, in reverse order, one account at a time: the same amounts
        for (w, want) in expected.iter().rev() {
            b.settle(w);
            assert_eq!(b.accounts[w].wallet, *want, "{w}");
            conserved(&b);
        }
        assert!(b.unsettled < g.len() as u128, "only rounding dust stays owed: {}", b.unsettled);
        b.advance_epoch(0);
        assert!(!b.collapsed);
        conserved(&b);
    }

    #[test]
    fn insurance_is_cut_pro_rata_at_the_ceiling() {
        let mut b = bank_with(&[("a", 5000), ("b", 5000), ("c", 1000), ("d", 1000)]);
        for w in ["c", "d"] { b.acct(w).wallet += 400; b.supply += 400; }
        b.insure("c", 100).unwrap();
        b.insure("d", 300).unwrap();
        for _ in 0..3 { b.advance_epoch(0); }
        b.withdraw_all("a").unwrap();
        // leave room for 600 of the 1,200 owed once the run's haircut has burned
        b.withdraw_all("b").unwrap();
        assert!(b.collapsed);
        let r = b.records[&0].clone();
        assert_eq!(r.ins_owed, 1200);
        assert_eq!(b.owed_to("c").1 * 3, b.owed_to("d").1, "same ratio for every insured account");
        b.settle_all();
        conserved(&b);
    }

    #[test]
    fn airdrops_are_rationed_and_leave_the_printer_room() {
        let mut b = crowd(100);
        for i in 0..AIRDROPS_PER_EPOCH { b.airdrop(&format!("new{i}")).unwrap(); }
        let err = b.airdrop("one-more").unwrap_err();
        assert!(err.contains("this bank day already"), "{err}");
        b.advance_epoch(0);
        b.airdrop("one-more").unwrap();
        // near the ceiling: the airdrop stops while a tenth of the ceiling is still free for the chair and a rescue
        let mut m = b.supply;
        for _ in 0..60 { m = b.supply + AIRDROP - 1 + m * AIRDROP_HEADROOM_PERMILLE / 1000; }
        b.max_supply = m;
        let err = b.airdrop("late").unwrap_err();
        assert!(err.contains("ceiling"), "{err}");
        assert!(b.mint_room() >= b.max_supply / 10);
        conserved(&b);
    }
}
