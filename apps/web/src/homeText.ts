/**
 * The words of the first screen (Home.tsx), kept apart from the component so they can be read and tested without
 * the page. Written for someone who has never heard of a blockchain: one sentence about what the coin is, three
 * steps of how it works, and the questions a newcomer actually asks, each answered in two or three sentences.
 */
import { EXPLORER } from "./chain/rpc";

/** The DAO ordered the chair to print 50%; the TEE-signed answer was refused by the contract (docs/TESTNET.md, section 3). */
const REFUSAL_TX = "AdjKfG7DKQn83hvuRoEKLfFAtUQDduz61zRSb1LbWfkM";

export const PITCH: { lead: [string, string]; rest: [string, string] } = {
  lead: ["$LEMON is a memecoin that can have a bank run.", "$LEMON — мемкойн, который сгорает, когда в его банке паника."],
  rest: ["The coin has a bank. An AI runs it, a lion called Leo, and sixty nervous depositors keep their coins there. If they all come for their money at once, the bank falls and some of the coins burn for good.",
    "У монеты есть банк. Им управляет ИИ — лев по имени Лео, а монеты в нём держат шестьдесят нервных вкладчиков. Побегут за деньгами все разом — банк рухнет, и часть монет сгорит навсегда."],
};

/** How it works, in three steps. */
export const STEPS: Array<{ title: [string, string]; body: [string, string] }> = [
  { title: ["The coins sit in a bank", "Монеты лежат в банке"],
    body: ["The bank lends most of them out and keeps only a part in its vault. While the depositors are calm, everyone earns interest.",
      "Большую часть банк раздаёт в долг, а в сейфе держит только часть. Пока вкладчики спокойны, все получают проценты."] },
  { title: ["Depositors panic, coins burn", "Вкладчики паникуют — монеты сгорают"],
    body: ["One gets scared and takes the money out; the neighbours see it and follow. To pay them the bank sells its loans at a loss, and those coins are gone for good.",
      "Один испугался и забрал деньги — соседи увидели и побежали следом. Чтобы расплатиться, банк продаёт долги себе в убыток, и эти монеты исчезают навсегда."] },
  { title: ["The bank falls and is rescued", "Банк падает — его спасают"],
    body: ["A rescue prints new coins into the vault: a fifth of what the bank still owed. Leo can add at most 5% a day, and nothing lifts the coin above its ceiling. The bank's program enforces this, even against the AI that runs it.",
      "При спасении программа банка печатает в сейф новые монеты: пятую часть того, что банк остался должен. Сам Лео может допечатать не больше 5% в день, а выше потолка монет не станет. Обойти эти пределы не может даже ИИ."] },
];

export interface Qa { q: [string, string]; a: [string, string]; link?: { href: string; text: [string, string] } }
/**
 * `{supply}` is replaced with the number of LEMON read from the network, `{ceiling}` with the bank's ceiling, each
 * only when the network reports it (otherwise it is left out, so the page never states a number it has not read).
 */
export const FAQ: Qa[] = [
  { q: ["Do the coins already exist?", "Монеты уже существуют?"],
    a: ["Yes. {supply}The coin has been living on the test network of the NEAR blockchain since 12 November 2026, and the number changes only when something happens at the bank: coins are printed or burned in that very operation, and each one is on record in the network.",
      "Да. {supply}Монета живёт в тестовой сети блокчейна NEAR с 12 ноября 2026 года. Число меняется только когда в банке что-то происходит: монеты печатаются или сгорают прямо в этой операции, и каждая такая операция записана в сети."] },
  { q: ["What is it worth, and where do I buy it?", "Сколько она стоит и где её купить?"],
    a: ["Nothing, and nowhere. It is a test coin: it has no price, it cannot be bought or sold, and we do not sell it. No real money is involved anywhere on this site.",
      "Нисколько и нигде. Это тестовая монета: у неё нет цены, её нельзя купить или продать, и мы её не продаём. Настоящих денег на этом сайте нет вообще."] },
  { q: ["Then how do I get it, and why is it free?", "Тогда как её получить и почему бесплатно?"],
    a: ["On \"My coins\" the bank gives a new account 1,000 LEMON, once. The bank's program prints those coins for the newcomer: on a test network that is the way in, and the rule is the same for everyone. With real money the way in would be paid.",
      "На экране «Мои монеты» банк выдаёт новому счёту 1 000 LEMON, один раз. Эти монеты программа банка печатает специально для новичка: в тестовой сети так устроен вход, и правило одно для всех. На настоящих деньгах вход был бы платным."] },
  { q: ["What do I do with it?", "Что мне с ней делать?"],
    a: ["Put it in the bank and you are one of the depositors: the deposit earns interest, and you decide whether to stay or to take it out. Everyone who takes money out brings the panic closer.",
      "Положить в банк — и ты один из вкладчиков: вклад растёт на проценты, а ты решаешь, оставаться или забирать. Каждый, кто забирает, приближает панику."] },
  { q: ["Who is Leo, and when does he speak?", "Кто такой Лео и когда он говорит?"],
    a: ["An AI model that runs the real bank: it sets the interest, decides how much to keep in the vault and how much to print. Leo makes one statement per bank day; when he is next on air is on \"The bank, live\".",
      "ИИ-модель, которая управляет настоящим банком: назначает процент, решает, сколько держать в сейфе и сколько печатать. Лео делает одно заявление за банковский день; когда он выйдет в эфир в следующий раз, написано на экране «Банк вживую»."] },
  { q: ["Can Leo print as much as he likes?", "Может ли Лео напечатать сколько захочет?"],
    a: ["No. We ordered him to print half of all the coins. He obeyed. The bank's program refused: 5% a day and not a coin more.{ceiling}",
      "Нет. Мы приказали ему напечатать половину всех монет. Он послушался. Программа банка отказала: 5% в день и ни монетой больше.{ceiling}"],
    link: { href: `${EXPLORER}/txns/${REFUSAL_TX}`, text: ["See that refusal on NEAR", "Посмотреть этот отказ в сети NEAR"] } },
  { q: ["What here is a game, and what is real?", "Что здесь игра, а что по-настоящему?"],
    a: ["\"Play\" is a simulation in your browser: you sit in Leo's chair on a copy of the bank, and you need no coin. \"My coins\" and \"The bank, live\" are the real bank on the test network.",
      "«Играть» — симуляция в твоём браузере: ты садишься в кресло Лео на копии банка, монета для этого не нужна. «Мои монеты» и «Банк вживую» — настоящий банк в тестовой сети."] },
];
