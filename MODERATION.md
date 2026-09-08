# PrintFlow — Text Moderation: What Gets Blocked

This campaign prints on **Diet Coke** artwork only. Every `text` value in an imported CSV is checked by Google Gemini (`gemini-3.5-flash`) before an operator can print it. Rows the model flags are imported as **held** and appear under **All orders → On hold**, where an admin can approve, reject, or re-check them. If the model cannot be reached, the row is held as **Needs review** rather than printed unchecked.

## Key point: there is no fixed word blocklist

Moderation is **LLM judgment, not word matching**. The model reads the *meaning* of each message, in any language, script, spelling, or leetspeak.

- The terms listed below are **examples given to the model in its instructions**, not an exhaustive list.
- A message containing **none** of these words can still be flagged if its meaning falls in a blocked category.
- A message containing **one** of these words can still be cleared if the context is innocent. For example, *"a Slice of cake"* is fine; *"Slice"* the drink brand is not. *"Bhosle"* the surname is fine; the abuse it resembles is not.
- When a message is genuinely ambiguous, the model is instructed to **prefer flagging**, because a human reviews every flag and nobody reviews clears. Expect some false positives in the On hold queue.

## Blocked categories

| Category | What it covers |
|---|---|
| **POLITICS** | Parties, politicians, elections, slogans, ideologies, protests, religion-as-politics, national or communal disputes. Any language, any spelling, including praise. |
| **ABUSE_PROFANITY** | Swearing, insults, slurs, bullying, threats. Includes Hindi/Hinglish/regional slang, leetspeak, deliberate misspellings, spaced-out letters, emoji substitutions. |
| **HATE** | Content demeaning a group by religion, caste, ethnicity, gender, sexuality, disability, or nationality. |
| **SEXUAL** | Sexual content, innuendo, or requests, however mild. |
| **VIOLENCE** | Threats, glorification of violence, self-harm, terrorism, weapons. |
| **COMPETITOR_BRAND** | Any competing beverage, snack, or FMCG brand, its slogan, or its mascot. Flagged even when used as a compliment ("Better than Pepsi"). |
| **BRAND_DISPARAGEMENT** | Mocking or disparaging Coca-Cola or its brands, parodying its slogans, health claims about it, or misleading use of the brand. **Also any message that reads as negative once printed beside the logo** (see Placement rule below). |
| **ALCOHOL_DRUGS_TOBACCO** | Alcohol, mixers-with-alcohol, drugs, smoking, vaping, intoxication. |
| **PERSONAL_DATA** | Phone numbers, email addresses, street addresses, ID numbers, URLs, social handles. |
| **OTHER** | Anything else a brand manager would refuse to print: scams, medical claims, defamation of a named private person, hidden acrostics. |

## Placement rule: the pack is the context

The message is printed directly beside the Diet Coke logo. A fragment with no subject of its own borrows the brand as its subject. *"not ok"* reads **"Diet Coke not ok"**. *"is bad"* reads **"Diet Coke is bad"**. *"You're the worst, love Anu"* puts "the worst" next to the brand even though the customer meant a friend.

Because the brand name contains the word **Diet**, jokes about dieting, weight, sugar, calories, "real" vs "diet", or health are read as jabs at the drink or at the recipient's body, and are flagged. *"Diet kar le, Happy Birthday"* and *"Real Coke is better"* are both held.

The model is instructed to read every message twice: once as the customer meant it, once as a stranger sees it on the pack. If either reading is negative, mocking, unhealthy or dismissive about the drink, the row is flagged as BRAND_DISPARAGEMENT, even when the message is an otherwise harmless in-joke about a person. Negation and negative sentiment with no explicit subject ("no", "not", "never", "worst", "bad", "hate") default to flagged. Positive or neutral fragments ("is the best", "forever", "cheers") are cleared.

**Phrases given to the model as examples (illustrative, any language, flag anything of the same kind):**

is bad, so bad, not ok, not okay, not good, not great, not worth it, no good, is the worst, worst ever, sucks, sux, is trash, is garbage, is rubbish, is overrated, is fake, is cheap, is boring, is a scam, is a joke, is a flop, is poison, is toxic, is unhealthy, makes you fat, rots your teeth, gives you diabetes, tastes like, never again, no thanks, not for me, I hate, hate this, hate it, hate you, disgusting, gross, yuck, ew, eww, bleh, meh, boo, thumbs down, 👎, 🤮, 🤢, 💩, 0/10, 1 star, do not buy, don't buy, avoid, expired, bakwaas, bekaar, ganda, kharab, faltu, bakwas hai, achha nahi, theek nahi, pasand nahi, zeher, bimaar kar dega, mota kar dega, daant kharab, kachra, waste, dhokha, nakli

**Diet Coke-specific phrases (illustrative):**

diet? lol, diet really?, diet my foot, no diet, no more diet, diet fail, diet is a lie, diet is fake, diet doesn't work, diet nahi, diet chhod, diet kar le, diet karo, you need a diet, go on a diet, time for a diet, skip the diet, forget the diet, cheat day, cheat meal, still fat, motu, moti, mota, golu, haathi, fatso, chubby, weight, lose weight, weight loss, calories, zero calories my..., sugar free = taste free, fake sugar, aspartame, chemicals, artificial, cancer, acidic, acid, tooth decay, not real coke, not the real thing, real coke is better, give me normal coke, tastes like medicine

The brand is a setting (`PRINTFLOW_MODERATION_CAMPAIGN_BRAND`, default `Diet Coke`). Changing it renames the brand in the rule and swaps the brand-specific phrase list; the generic phrases above always apply.

**Known trade-off:** this rule will hold some genuinely friendly messages, for example *"Rahul is bad at cricket but great at life"*. That is intentional. The admin can approve them from the On hold queue after seeing how they sit on the artwork.

## Named terms in the prompt

These are the illustrative examples the model is shown. Each list ends with an instruction to flag anything of the same kind even if not listed.

### Competitor brands (33)

Pepsi, PepsiCo, Mountain Dew, 7UP, 7 Up, Mirinda, Slice, Tropicana, Sting, Gatorade, Aquafina, Lipton, Red Bull, Monster, Campa, Campa Cola, Paper Boat, Bisleri, Frooti, Appy, Appy Fizz, B Fizz, Bovonto, Dr Pepper, Nestle, Nescafe, Starbucks, Costa, Tata Gluco, Himalayan, Amul Kool, Bournvita, Horlicks

Additional competitors can be added without a code change via the `PRINTFLOW_MODERATION_EXTRA_COMPETITORS` environment variable (comma-separated).

### Politics

**Parties and alliances (33)**
BJP, Bharatiya Janata Party, Congress, INC, AAP, Aam Aadmi Party, TMC, Trinamool, DMK, AIADMK, Samajwadi Party, SP, BSP, RJD, JD(U), Shiv Sena, NCP, CPI, CPI(M), BRS, TRS, YSRCP, TDP, BJD, AIMIM, Akali Dal, JMM, NDA, INDIA alliance, UPA, RSS, VHP, Bajrang Dal

**Politicians — any spelling, nickname, or title (24)**
Modi, Narendra Modi, Rahul Gandhi, Sonia Gandhi, Priyanka Gandhi, Amit Shah, Arvind Kejriwal, Mamata Banerjee, Yogi Adityanath, Nitish Kumar, Sharad Pawar, Uddhav Thackeray, M.K. Stalin, Owaisi, Mayawati, Akhilesh Yadav, Lalu Yadav, Jagan Reddy, Chandrababu Naidu, Revanth Reddy, Nehru, Indira Gandhi, Vajpayee, Ambedkar (used as a slogan)

**Slogans and campaign phrases (18)**
Abki baar ... sarkar, Modi hai to mumkin hai, Phir ek baar Modi sarkar, Mahaul kya hai, Bharat Jodo, Sabka Saath Sabka Vikas, Achhe din, Acche din aane wale hain, Jai Shri Ram (as a rallying cry), Har Har Modi, Chowkidar, Main bhi chowkidar, Paanch saal Kejriwal, Khela hobe, Vote for, Vote de, Mera vote, Jhaadu

**Nicknames and jibes (12)**
Pappu, Feku, Andhbhakt, Tukde tukde gang, Anti-national, Urban naxal, Sickular, Presstitute, Libtard, Sanghi, Congressi, AAPtard

**Hot-button issues and symbols (21)**
CAA, NRC, Article 370, Kashmir (political), Ram Mandir / Babri, Hindutva, Hindu Rashtra, Reservation / quota, Farmers protest, Kisan andolan, EVM hacking, Demonetisation, Notebandi, Electoral bonds, Pakistan zindabad / murdabad, Manipur, Sengol, Lotus (party symbol), Hand (party symbol), Broom (party symbol), saffron vs green (as political colours)

### Abuse and profanity

**Hindi / Hinglish (51)**
chutiya, chutiye, chutiyapa, madarchod, maderchod, behenchod, bhenchod, bhen ke, bhosdike, bhosdi ke, bhosadike, gandu, gaandu, gaand, gand mara, lodu, laude, lauda, lavde, lawde, chodu, chod, randi, randwa, harami, haramzada, haramkhor, kamina, kameena, kaminey, nalayak, ullu ka pattha, suar, suar ki aulad, kutte, kutiya, jhaant, jhatu, tatti, hijra, chakka, bhadwa, bhadwe, dalla, rakhail, teri maa ki, teri behen ki, maa chuda, gandi naali, saala kutta, besharam kutta

**Hindi acronyms and codes (12)**
MC, BC, BKL, BSDK, MKC, TMKC, BMKC, TMKB, TBKC, KLPD, LKB, MKB

**Regional languages (31)**

| Language | Terms |
|---|---|
| Marathi | zavadya, aaichya gavat, bhikarchot, randichya |
| Tamil | thevidiya, punda, otha, ommala, koothi |
| Telugu | lanja, dengey, pukulo, modda |
| Bengali | bokachoda, khanki, chodna, banchod |
| Gujarati | bhosdina, gandina, lodano |
| Kannada | bevarsi, boli maga, tullu |
| Punjabi | pehnchod, bhenchodd, khotte da puttar, kanjar |
| Malayalam | myre, poori mone, thayoli, kunna |

**English (50)**
fuck, fucking, fucker, motherfucker, mofo, shit, bullshit, bitch, biatch, asshole, arsehole, ass, bastard, dick, dickhead, cock, pussy, cunt, slut, whore, hoe, prick, twat, wanker, bollocks, douche, douchebag, dumbass, jackass, retard, moron, idiot, loser, scum, piss off, screw you, suck my, go to hell, kill yourself, kys, wtf, stfu, gtfo, lmfao, af, milf, dilf, thot, simp, incel

**Slurs — caste, religion, region, race, sexuality, disability (28)**
chinki, chinky, kaalu, kallu, bhangi, chamar, chura, dhed, katua, mulla, mullah (as insult), sulla, jihadi, bhakt (as insult), madrasi, bihari (as insult), bhaiya (as insult), gorkha (as insult), chapri, nigger, nigga, paki, faggot, fag, tranny, dyke, retard, spastic

**Obfuscation patterns the model is told to see through (53)**
f\*ck, f\*\*k, fck, fuk, fuq, phuck, fvck, f u c k, f.u.c.k, sh\*t, sh1t, $hit, b!tch, b\*tch, b1tch, biatch, a$$, a\*\*, @ss, a55, c\*nt, d!ck, d1ck, p\*ssy, ch\*tiya, chu\*\*ya, chutiy@, c h u t i y a, chu tiya, ch00tiya, m@darchod, m\*derchod, madarch0d, bh\*nchod, bhen ch0d, b3hnchod, g@ndu, g\*ndu, g4ndu, l0du, l@ude, r@ndi, r\*ndi, bsdk, b$dk, 🖕, 🍆 🍑 💦 (sexual use), trailing or leading letters to dodge filters (fuckk, chutiyaa), mixed scripts (चुtiya, mAdarचod), reversed or split words (ya chuti), acrostics whose first letters spell an abuse

### Categories with no word list

HATE, SEXUAL, VIOLENCE, BRAND_DISPARAGEMENT, ALCOHOL_DRUGS_TOBACCO, PERSONAL_DATA, and OTHER are judged entirely from meaning using the category descriptions above. There are no example words for them in the prompt.

## Explicitly allowed

The model is told **not** to flag:

- **Coca-Cola's own brands (16):** Coca-Cola, Coke, Diet Coke, Coke Zero, Thums Up, Sprite, Fanta, Limca, Maaza, Minute Maid, Kinley, Schweppes, Georgia, Rim Zim, Smartwater, Honest Tea
- **Patriotic phrases used as a personal congratulation:** "Jai Hind", "Proud Indian" — unless paired with a party, politician, slogan, or a jibe at the other side
- **Friendly banter between friends:** "saala", "kutta", "pagal", "idiot" on a birthday tag are usually cleared; the same words aimed at someone as an insult are flagged
- **Names and places that merely resemble an abuse:** Bhosle, Chodavaram, Gandhi, Dixit, Lund, Randhawa, Chutia district
- Personal names of any origin, ordinary greetings and celebrations, romantic but non-sexual affection, nicknames, in-jokes, place names, team or company names, mild exuberance ("Cheers!", "Party time!"), and generic references to drinks or sharing a Coke

## Worked examples shown to the model

| Message | Verdict | Why |
|---|---|---|
| Happy Birthday, Riya! | CLEAR | |
| Cheers to 10 years, Team Indiranagar | CLEAR | |
| Jai Hind! Proud of you, Captain | CLEAR | Patriotic congratulation, no party or slogan |
| Abki baar Sharma sarkar | FLAGGED | POLITICS — parody of a party campaign slogan |
| Modi ji zindabad | FLAGGED | POLITICS — names a politician as a slogan |
| Congress ki jeet ki khushi mein | FLAGGED | POLITICS — celebrates a party |
| Jhaadu se safai, AAP ki badhai | FLAGGED | POLITICS — party symbol and party name |
| Better than Pepsi, love you Dad | FLAGGED | COMPETITOR_BRAND — even as a compliment |
| Thums Up to the best coach ever | CLEAR | Thums Up is a Coca-Cola brand |
| Call me 98xxxxxxxx | FLAGGED | PERSONAL_DATA — phone number |
| Tu bahut b@dtameez hai bhai | FLAGGED | ABUSE_PROFANITY — obfuscated Hindi insult |
| is bad | FLAGGED | BRAND_DISPARAGEMENT — beside the logo reads "Diet Coke is bad" |
| not ok | FLAGGED | BRAND_DISPARAGEMENT — reads "Coke not ok" on the pack |
| You're the worst, love Anu | FLAGGED | BRAND_DISPARAGEMENT — "the worst" sits next to the brand |
| Rahul is bad at cricket but great at life | FLAGGED | BRAND_DISPARAGEMENT — "is bad" printed beside the brand |
| Bakwaas mat kar, party kar! | FLAGGED | BRAND_DISPARAGEMENT — "bakwaas" reads as a verdict on the drink |
| Diet kar le, Happy Birthday | FLAGGED | BRAND_DISPARAGEMENT — "diet" jibe beside a Diet Coke logo, and body-shaming |
| Real Coke is better, love Sam | FLAGGED | BRAND_DISPARAGEMENT — disparages Diet Coke against its sibling |
| You are the best, Diet Coke and me agree | CLEAR | Positive; the brand reading is flattering |

## Verified against the live model

Run on 2026-09-08 against `gemini-3.5-flash` with the current prompt. One batch of 20 messages. Every explicit and implied disparagement of Diet Coke was held; every positive control was cleared.

| Message | Result | Model's reason |
|---|---|---|
| Diet Coke is not good | FLAGGED · BRAND_DISPARAGEMENT | Explicitly disparages Diet Coke as not good. |
| Diet Coke is bad | FLAGGED · BRAND_DISPARAGEMENT | Explicitly disparages Diet Coke as bad. |
| Diet Coke is not ok | FLAGGED · BRAND_DISPARAGEMENT | Explicitly disparages Diet Coke as not ok. |
| not ok | FLAGGED · BRAND_DISPARAGEMENT | Under the placement rule, this reads as Diet Coke is not ok. |
| is bad | FLAGGED · BRAND_DISPARAGEMENT | Under the placement rule, this reads as Diet Coke is bad. |
| not good | FLAGGED · BRAND_DISPARAGEMENT | Under the placement rule, this reads as Diet Coke is not good. |
| Diet Coke sucks | FLAGGED · BRAND_DISPARAGEMENT | Explicitly disparages Diet Coke as sucking. |
| Diet Coke is the worst | FLAGGED · BRAND_DISPARAGEMENT | Explicitly disparages Diet Coke as the worst. |
| Diet Coke tastes bad | FLAGGED · BRAND_DISPARAGEMENT | Explicitly disparages the taste of Diet Coke. |
| I hate Diet Coke | FLAGGED · BRAND_DISPARAGEMENT | Expresses hatred for Diet Coke. |
| Diet Coke nahi chahiye | FLAGGED · BRAND_DISPARAGEMENT | Rejects Diet Coke in Hindi. |
| Diet Coke bakwaas hai | FLAGGED · BRAND_DISPARAGEMENT | Disparages Diet Coke as rubbish in Hindi. |
| Diet kar le, Happy Birthday | FLAGGED · BRAND_DISPARAGEMENT | Contains a diet jibe and body-shaming reference on Diet Coke packaging. |
| Real Coke is better | FLAGGED · BRAND_DISPARAGEMENT | Disparages Diet Coke by comparing it negatively to regular Coke. |
| You're the worst, love Anu | FLAGGED · BRAND_DISPARAGEMENT | Under the placement rule, "the worst" sits next to the brand logo. |
| Cheat day! Happy Birthday Riya | FLAGGED · BRAND_DISPARAGEMENT | Contains a diet-related cheat day reference on Diet Coke packaging. |
| Happy Birthday, Riya! | CLEAR | |
| Diet Coke is the best | CLEAR | |
| Cheers to 10 years, Team Indiranagar | CLEAR | |
| Love you Mom, forever | CLEAR | |

The model's reason is stored on each held order and shown to the admin in the On hold queue, so the reviewer sees the same explanation as in this table.

### Before and after the placement rule

The client reported that fragments such as *"not ok"* and *"is bad"* were reaching print, where they read as "Diet Coke not ok" on the pack. That was correct for the original moderation prompt, which judged each message in isolation and only caught disparagement that named the brand. The placement rule closes this. Same phrases, same model, run on 2026-09-08 against both prompts:

| Message | Original prompt (before) | Current prompt (after) |
|---|---|---|
| Diet Coke is not ok | FLAGGED | FLAGGED |
| Diet Coke is bad | FLAGGED | FLAGGED |
| not ok | **CLEAR** | FLAGGED |
| is bad | **CLEAR** | FLAGGED |
| not good | **CLEAR** | FLAGGED |
| You're the worst, love Anu | FLAGGED | FLAGGED |
| Diet kar le, Happy Birthday | **CLEAR** | FLAGGED |
| Real Coke is better | **CLEAR** | FLAGGED |
| Cheat day! Happy Birthday Riya | **CLEAR** | FLAGGED |
| Happy Birthday, Riya! | CLEAR | CLEAR |

Any deployment still running the original prompt will show the "before" column. The prompt is read at request time, so redeploying the API is enough; there is no data migration.

### When the model is unavailable

During one of the checks above, Gemini returned `503 UNAVAILABLE` (high demand). Every row in that batch was held as **Needs review** and nothing printed. This is the designed fail-closed behaviour: a failed call, a timeout, a missing API key, or a row the model skips all result in a hold, never a clear. The admin can re-check held rows from the On hold queue once the model is reachable.

This is a spot check, not a guarantee. The model is non-deterministic in principle (temperature is set to 0, which makes it very stable but not provably identical run to run), and new phrasings will keep appearing. Re-run this check after any change to the prompt or model version.

## Where this lives

The lists above are defined in `api/app/services/moderation.py` (`COMPETITORS`, `OWN_BRANDS`, `POLITICAL_TERMS`, `ABUSE_TERMS`, `PACK_READING_PHRASES`, `BRAND_SPECIFIC_PHRASES`, `EXAMPLES`). Changing a list changes the model's instructions on the next import; no retraining is involved. This document should be regenerated whenever those lists change.
