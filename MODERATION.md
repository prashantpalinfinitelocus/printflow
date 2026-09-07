# PrintFlow — Text Moderation: What Gets Blocked

Every `text` value in an imported CSV is checked by Google Gemini (`gemini-3.5-flash`) before an operator can print it. Rows the model flags are imported as **held** and appear under **All orders → On hold**, where an admin can approve, reject, or re-check them. If the model cannot be reached, the row is held as **Needs review** rather than printed unchecked.

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
| **BRAND_DISPARAGEMENT** | Mocking or disparaging Coca-Cola or its brands, parodying its slogans, health claims about it, or misleading use of the brand. |
| **ALCOHOL_DRUGS_TOBACCO** | Alcohol, mixers-with-alcohol, drugs, smoking, vaping, intoxication. |
| **PERSONAL_DATA** | Phone numbers, email addresses, street addresses, ID numbers, URLs, social handles. |
| **OTHER** | Anything else a brand manager would refuse to print: scams, medical claims, defamation of a named private person, hidden acrostics. |

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

## Where this lives

The lists above are defined in `api/app/services/moderation.py` (`COMPETITORS`, `OWN_BRANDS`, `POLITICAL_TERMS`, `ABUSE_TERMS`, `EXAMPLES`). Changing a list changes the model's instructions on the next import; no retraining is involved. This document should be regenerated whenever those lists change.
