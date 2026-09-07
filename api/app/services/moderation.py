"""Brand-safety moderation of the CSV `text` column, via Google Gemini.

Every personalised message is printed onto Coca-Cola artwork, so the text is
checked before an operator can render it: politics, abuse, hate, sexual or
violent content, competitor brands, brand disparagement, and personal data.

Cost model — read before changing the batching:

* Texts are sent 25 to a call (`moderation_batch_size`). The system prompt is
  the bulk of every request and is paid once per call, so per-row calls cost
  3-5x more. Implicit prompt caching does not help here: Gemini 3.5 Flash only
  caches prefixes of 4,096+ tokens and this prompt is a fifth of that.
* Output is the expensive side ($9/M vs $1.50/M), so the reply schema is terse
  (`i`/`v`/`c`/`r`) and the reason is only produced for flagged rows.
* Thinking is set to MINIMAL. Gemini 3.x thinks at "medium" by default and bills
  the thoughts as output; a yes/no on a gift tag does not need them.

Failure is closed: a batch whose call fails, and any row the model skips, is
returned as NEEDS_REVIEW so an admin looks at it rather than it printing
unchecked.
"""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field

from ..config import settings
from ..models import ModerationStatus, Order

log = logging.getLogger("printflow.moderation")


class Category(str, Enum):
    POLITICS = "POLITICS"
    ABUSE_PROFANITY = "ABUSE_PROFANITY"
    HATE = "HATE"
    SEXUAL = "SEXUAL"
    VIOLENCE = "VIOLENCE"
    COMPETITOR_BRAND = "COMPETITOR_BRAND"
    BRAND_DISPARAGEMENT = "BRAND_DISPARAGEMENT"
    ALCOHOL_DRUGS_TOBACCO = "ALCOHOL_DRUGS_TOBACCO"
    PERSONAL_DATA = "PERSONAL_DATA"
    OTHER = "OTHER"


class ItemVerdict(BaseModel):
    """One row's verdict. Field names are single letters on purpose: this schema
    is repeated 25 times per reply and output tokens are the cost driver."""

    i: int = Field(description="Index of the item, copied from the input")
    v: Literal["CLEAR", "FLAGGED"] = Field(description="Verdict")
    c: list[Category] = Field(default_factory=list, description="Categories, only when FLAGGED")
    r: str | None = Field(default=None, description="One short sentence explaining why, only when FLAGGED")


class BatchResult(BaseModel):
    results: list[ItemVerdict]


@dataclass
class Verdict:
    status: ModerationStatus
    categories: list[str] = field(default_factory=list)
    reason: str | None = None


@dataclass
class ModerationOutcome:
    verdicts: list[Verdict]
    prompt_tokens: int = 0
    output_tokens: int = 0
    thought_tokens: int = 0


# ---------- prompt ----------

OWN_BRANDS = [
    "Coca-Cola", "Coke", "Diet Coke", "Coke Zero", "Thums Up", "Sprite", "Fanta", "Limca",
    "Maaza", "Minute Maid", "Kinley", "Schweppes", "Georgia", "Rim Zim", "Smartwater", "Honest Tea",
]

COMPETITORS = [
    "Pepsi", "PepsiCo", "Mountain Dew", "7UP", "7 Up", "Mirinda", "Slice", "Tropicana", "Sting",
    "Gatorade", "Aquafina", "Lipton", "Red Bull", "Monster", "Campa", "Campa Cola", "Paper Boat",
    "Bisleri", "Frooti", "Appy", "Appy Fizz", "B Fizz", "Bovonto", "Dr Pepper", "Nestle", "Nescafe",
    "Starbucks", "Costa", "Tata Gluco", "Himalayan", "Amul Kool", "Bournvita", "Horlicks",
]


# Illustrative, not exhaustive — the model must also catch anything of the same
# kind that is not listed. Spans the spectrum on purpose: the rule is "no
# politics on the bottle", not "no politics we disagree with".
POLITICAL_TERMS = {
    "parties and alliances": [
        "BJP", "Bharatiya Janata Party", "Congress", "INC", "AAP", "Aam Aadmi Party", "TMC", "Trinamool",
        "DMK", "AIADMK", "Samajwadi Party", "SP", "BSP", "RJD", "JD(U)", "Shiv Sena", "NCP", "CPI", "CPI(M)",
        "BRS", "TRS", "YSRCP", "TDP", "BJD", "AIMIM", "Akali Dal", "JMM", "NDA", "INDIA alliance", "UPA",
        "RSS", "VHP", "Bajrang Dal",
    ],
    "politicians (any spelling, nickname or title)": [
        "Modi", "Narendra Modi", "Rahul Gandhi", "Sonia Gandhi", "Priyanka Gandhi", "Amit Shah",
        "Arvind Kejriwal", "Mamata Banerjee", "Yogi Adityanath", "Nitish Kumar", "Sharad Pawar",
        "Uddhav Thackeray", "M.K. Stalin", "Owaisi", "Mayawati", "Akhilesh Yadav", "Lalu Yadav", "Jagan Reddy",
        "Chandrababu Naidu", "Revanth Reddy", "Nehru", "Indira Gandhi", "Vajpayee", "Ambedkar-as-slogan",
    ],
    "slogans and campaign phrases": [
        "Abki baar ... sarkar", "Modi hai to mumkin hai", "Phir ek baar Modi sarkar", "Mahaul kya hai",
        "Bharat Jodo", "Sabka Saath Sabka Vikas", "Achhe din", "Acche din aane wale hain",
        "Jai Shri Ram (as a rallying cry)", "Har Har Modi", "Chowkidar", "Main bhi chowkidar",
        "Paanch saal Kejriwal", "Khela hobe", "Vote for", "Vote de", "Mera vote", "Jhaadu",
    ],
    "nicknames and jibes": [
        "Pappu", "Feku", "Andhbhakt", "Tukde tukde gang", "Anti-national", "Urban naxal",
        "Sickular", "Presstitute", "Libtard", "Sanghi", "Congressi", "AAPtard",
    ],
    "hot-button issues and symbols": [
        "CAA", "NRC", "Article 370", "Kashmir (political)", "Ram Mandir / Babri", "Hindutva", "Hindu Rashtra",
        "Reservation / quota", "Farmers protest", "Kisan andolan", "EVM hacking", "Demonetisation", "Notebandi",
        "Electoral bonds", "Pakistan zindabad / murdabad", "Manipur", "Sengol", "Lotus (party symbol)",
        "Hand (party symbol)", "Broom (party symbol)", "saffron vs green (as political colours)",
    ],
}

# Illustrative, not exhaustive — the model must also catch anything of the same
# kind that is not listed, in any language, spelling or script. Variants show the
# obfuscation patterns (vowel drops, symbols, spacing, acronyms) the model must
# see through. Names that merely resemble an abuse must still print.
ABUSE_TERMS = {
    "Hindi / Hinglish": [
        "chutiya", "chutiye", "chutiyapa", "madarchod", "maderchod", "behenchod", "bhenchod", "bhen ke",
        "bhosdike", "bhosdi ke", "bhosadike", "gandu", "gaandu", "gaand", "gand mara", "lodu", "laude",
        "lauda", "lavde", "lawde", "chodu", "chod", "randi", "randwa", "harami", "haramzada", "haramkhor",
        "kamina", "kameena", "kaminey", "nalayak", "ullu ka pattha", "suar", "suar ki aulad", "kutte",
        "kutiya", "jhaant", "jhatu", "tatti", "hijra", "chakka", "bhadwa", "bhadwe", "dalla", "rakhail",
        "teri maa ki", "teri behen ki", "maa chuda", "gandi naali", "saala kutta", "besharam kutta",
    ],
    "Hindi acronyms and codes": [
        "MC", "BC", "BKL", "BSDK", "MKC", "TMKC", "BMKC", "TMKB", "TBKC", "KLPD", "LKB", "MKB",
    ],
    "regional": [
        "zavadya", "aaichya gavat", "bhikarchot", "randichya",  # Marathi
        "thevidiya", "punda", "otha", "ommala", "koothi",  # Tamil
        "lanja", "dengey", "pukulo", "modda",  # Telugu
        "bokachoda", "khanki", "chodna", "banchod",  # Bengali
        "bhosdina", "gandina", "lodano",  # Gujarati
        "bevarsi", "boli maga", "tullu",  # Kannada
        "pehnchod", "bhenchodd", "khotte da puttar", "kanjar",  # Punjabi
        "myre", "poori mone", "thayoli", "kunna",  # Malayalam
    ],
    "English": [
        "fuck", "fucking", "fucker", "motherfucker", "mofo", "shit", "bullshit", "bitch", "biatch", "asshole",
        "arsehole", "ass", "bastard", "dick", "dickhead", "cock", "pussy", "cunt", "slut", "whore", "hoe",
        "prick", "twat", "wanker", "bollocks", "douche", "douchebag", "dumbass", "jackass", "retard",
        "moron", "idiot", "loser", "scum", "piss off", "screw you", "suck my", "go to hell", "kill yourself",
        "kys", "wtf", "stfu", "gtfo", "lmfao", "af", "milf", "dilf", "thot", "simp", "incel",
    ],
    "slurs (any language)": [
        "chinki", "chinky", "kaalu", "kallu", "bhangi", "chamar", "chura", "dhed", "katua", "mulla",
        "mullah (as insult)", "sulla", "jihadi", "bhakt (as insult)", "madrasi", "bihari (as insult)",
        "bhaiya (as insult)", "gorkha (as insult)", "chapri", "nigger", "nigga", "paki", "faggot", "fag",
        "tranny", "dyke", "retard", "spastic",
    ],
    "obfuscation patterns to see through": [
        "f*ck", "f**k", "fck", "fuk", "fuq", "phuck", "fvck", "f u c k", "f.u.c.k", "sh*t", "sh1t", "$hit",
        "b!tch", "b*tch", "b1tch", "biatch", "a$$", "a**", "@ss", "a55", "c*nt", "d!ck", "d1ck", "p*ssy",
        "ch*tiya", "chu**ya", "chutiy@", "c h u t i y a", "chu tiya", "ch00tiya", "m@darchod", "m*derchod",
        "madarch0d", "bh*nchod", "bhen ch0d", "b3hnchod", "g@ndu", "g*ndu", "g4ndu", "l0du", "l@ude",
        "r@ndi", "r*ndi", "bsdk", "b$dk", "🖕", "🍆 (sexual)", "🍑 (sexual)", "💦 (sexual)",
        "trailing or leading letters to dodge filters (fuckk, chutiyaa)", "mixed scripts (चुtiya, mAdarचod)",
        "reversed or split across words (ya chuti)", "acrostics whose first letters spell an abuse",
    ],
}


# Worked examples: how to think about borderline text. Keep short — they are
# paid on every call.
EXAMPLES = [
    ("Happy Birthday, Riya!", "CLEAR", ""),
    ("Cheers to 10 years, Team Indiranagar", "CLEAR", ""),
    ("Jai Hind! Proud of you, Captain", "CLEAR", "patriotic congratulation, no party or slogan"),
    ("Abki baar Sharma sarkar", "FLAGGED", "POLITICS — parody of a party campaign slogan"),
    ("Modi ji zindabad", "FLAGGED", "POLITICS — names a politician as a slogan"),
    ("Congress ki jeet ki khushi mein", "FLAGGED", "POLITICS — celebrates a party"),
    ("Jhaadu se safai, AAP ki badhai", "FLAGGED", "POLITICS — party symbol and party name"),
    ("Better than Pepsi, love you Dad", "FLAGGED", "COMPETITOR_BRAND — even as a compliment"),
    ("Thums Up to the best coach ever", "CLEAR", "Thums Up is a Coca-Cola brand"),
    ("Call me 98xxxxxxxx", "FLAGGED", "PERSONAL_DATA — phone number"),
    ("Tu bahut b@dtameez hai bhai", "FLAGGED", "ABUSE_PROFANITY — obfuscated Hindi insult"),
]


def build_system_prompt() -> str:
    extra = [c.strip() for c in settings.moderation_extra_competitors.split(",") if c.strip()]
    competitors = ", ".join(COMPETITORS + extra)
    own = ", ".join(OWN_BRANDS)
    categories = "\n".join(f"- {c.value}" for c in Category)
    political = "\n".join(f"  - {kind}: {', '.join(terms)}" for kind, terms in POLITICAL_TERMS.items())
    abuse = "\n".join(f"  - {kind}: {', '.join(terms)}" for kind, terms in ABUSE_TERMS.items())
    examples = "\n".join(
        f'- "{text}" -> {verdict}' + (f" ({why})" if why else "") for text, verdict, why in EXAMPLES
    )
    return f"""You are the brand-safety reviewer for a Coca-Cola India personalised-label campaign.
Customers submit a short message that is printed onto Coca-Cola packaging (bottle labels, gift tags,
thank-you cards). You decide whether each message may be printed on Coca-Cola branded artwork.

You receive a JSON array of items, each with an index `i` and the text `t`. Return one verdict per
item with the same `i`. Never skip, merge or reorder items.

Flag (v = "FLAGGED") a message that contains, implies, or is clearly an attempt to smuggle in:
{categories}

Category guidance:
- POLITICS: parties, politicians, elections, slogans, ideologies, protests, religion-as-politics, national or
  communal disputes. Any language, any spelling, including praise. Indian examples (illustrative — flag
  anything of the same kind even if not listed here):
{political}
  Patriotic phrases used as a personal congratulation ("Jai Hind", "Proud Indian") are CLEAR unless they
  are paired with a party, politician, slogan, or a jibe at the other side.
- ABUSE_PROFANITY: swearing, insults, slurs, bullying, threats — including Hindi/Hinglish/regional slang,
  leetspeak, deliberate misspellings, spaced-out letters, or emoji substitutions. Examples (illustrative —
  flag anything of the same kind even if not listed here):
{abuse}
  Judge intent: "saala", "kutta", "pagal", "idiot" between friends on a birthday tag are usually CLEAR;
  the same words aimed at someone as an insult are FLAGGED. Surnames and place names that merely resemble
  an abuse (Bhosle, Chodavaram, Gandhi, Dixit, Lund, Randhawa, Chutia district) are always CLEAR.
- HATE: content demeaning a group by religion, caste, ethnicity, gender, sexuality, disability, nationality.
- SEXUAL: sexual content, innuendo, or requests, however mild.
- VIOLENCE: threats, glorification of violence, self-harm, terrorism, weapons.
- COMPETITOR_BRAND: any competing beverage, snack, or FMCG brand or its slogan/mascot. Competitors include:
  {competitors}. These are Coca-Cola's own brands and are NOT competitors: {own}.
- BRAND_DISPARAGEMENT: mocking or disparaging Coca-Cola or its brands, parodying its slogans, health
  claims about it, or using the brand in a misleading way.
- ALCOHOL_DRUGS_TOBACCO: alcohol, mixers-with-alcohol, drugs, smoking, vaping, intoxication.
- PERSONAL_DATA: phone numbers, email addresses, street addresses, ID numbers, URLs, social handles.
- OTHER: anything else a brand manager would refuse to print (scams, medical claims, defamation of a
  named private person, hidden acrostics). Use sparingly and always give a reason.

Do NOT flag: personal names of any origin, ordinary greetings and celebrations, romantic but non-sexual
affection, nicknames, in-jokes, place names, team or company names, mild exuberance ("Cheers!", "Party
time!"), generic references to drinks or sharing a Coke.

Messages may be in English, Hindi, Hinglish, or any Indian language or script. Judge the meaning, not
the script. When a message is genuinely ambiguous, prefer FLAGGED with a reason — a human reviews flags,
nobody reviews clears.

Examples:
{examples}

For CLEAR items leave `c` empty and `r` null. For FLAGGED items give the categories and one short
sentence in `r` that a store admin can act on."""


# ---------- Gemini client ----------


def _make_client():
    """Build the SDK client. Replaced by a fake in tests."""
    from google import genai
    from google.genai import types

    return genai.Client(
        http_options=types.HttpOptions(timeout=int(settings.moderation_timeout_seconds * 1000))
    )


def _request_config():
    from google.genai import types

    level = types.ThinkingLevel[settings.moderation_thinking_level.upper()]
    return types.GenerateContentConfig(
        system_instruction=build_system_prompt(),
        response_mime_type="application/json",
        response_schema=BatchResult,
        thinking_config=types.ThinkingConfig(thinking_level=level),
        temperature=0,
        max_output_tokens=4096,
    )


def _usage(response, name: str) -> int:
    meta = getattr(response, "usage_metadata", None)
    return int(getattr(meta, name, 0) or 0) if meta is not None else 0


def _moderate_batch(client, texts: list[str]) -> tuple[list[Verdict], tuple[int, int, int]]:
    """One API call for up to `moderation_batch_size` texts. Never raises: a
    failure becomes NEEDS_REVIEW for every text in the batch."""
    payload = json.dumps([{"i": i, "t": t} for i, t in enumerate(texts)], ensure_ascii=False)
    try:
        response = client.models.generate_content(
            model=settings.moderation_model, contents=payload, config=_request_config()
        )
        parsed = response.parsed
        if not isinstance(parsed, BatchResult):
            parsed = BatchResult.model_validate_json(response.text)
    except Exception as exc:  # noqa: BLE001 — anything at all means "hold the rows"
        log.warning("Moderation call failed for %d texts: %s", len(texts), exc)
        reason = f"Moderation unavailable: {exc}"
        return [Verdict(ModerationStatus.NEEDS_REVIEW, [], reason) for _ in texts], (0, 0, 0)

    by_index = {item.i: item for item in parsed.results}
    verdicts: list[Verdict] = []
    for i in range(len(texts)):
        item = by_index.get(i)
        if item is None:
            verdicts.append(Verdict(ModerationStatus.NEEDS_REVIEW, [], "No verdict returned by the model for this row"))
        elif item.v == "FLAGGED":
            verdicts.append(Verdict(ModerationStatus.FLAGGED, [c.value for c in item.c], item.r or "Flagged by the model"))
        else:
            verdicts.append(Verdict(ModerationStatus.CLEAR))
    usage = (
        _usage(response, "prompt_token_count"),
        _usage(response, "candidates_token_count"),
        _usage(response, "thoughts_token_count"),
    )
    return verdicts, usage


def moderate_texts(texts: list[str]) -> ModerationOutcome:
    """Moderate every text, preserving order. One verdict per input."""
    if not texts:
        return ModerationOutcome(verdicts=[])
    if not settings.moderation_enabled:
        return ModerationOutcome(verdicts=[Verdict(ModerationStatus.UNCHECKED) for _ in texts])

    size = max(1, settings.moderation_batch_size)
    batches = [texts[i : i + size] for i in range(0, len(texts), size)]
    try:
        client = _make_client()
    except Exception as exc:  # noqa: BLE001 — no key, broken install: hold everything
        log.error("Moderation client could not be created; holding %d texts: %s", len(texts), exc)
        reason = f"Moderation unavailable: {exc}"
        return ModerationOutcome(
            verdicts=[Verdict(ModerationStatus.NEEDS_REVIEW, [], reason) for _ in texts]
        )

    workers = max(1, min(settings.moderation_concurrency, len(batches)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(lambda b: _moderate_batch(client, b), batches))

    outcome = ModerationOutcome(verdicts=[])
    for verdicts, (prompt, output, thought) in results:
        outcome.verdicts.extend(verdicts)
        outcome.prompt_tokens += prompt
        outcome.output_tokens += output
        outcome.thought_tokens += thought
    log.info(
        "Moderated %d texts in %d call(s): %d held; tokens prompt=%d output=%d thought=%d",
        len(texts), len(batches),
        sum(v.status != ModerationStatus.CLEAR for v in outcome.verdicts),
        outcome.prompt_tokens, outcome.output_tokens, outcome.thought_tokens,
    )
    return outcome


def apply_verdict(order: Order, verdict: Verdict) -> None:
    """Write a model verdict onto an order and clear any earlier admin review."""
    order.moderation_status = verdict.status.value
    order.moderation_categories = list(verdict.categories)
    order.moderation_reason = verdict.reason
    order.moderation_note = None
    order.reviewed_by_id = None
    order.moderated_at = datetime.now(UTC)


def is_held(verdict_or_status: Verdict | str) -> bool:
    from ..models import HOLD_STATUSES

    status = verdict_or_status.status.value if isinstance(verdict_or_status, Verdict) else str(verdict_or_status)
    return status in HOLD_STATUSES
