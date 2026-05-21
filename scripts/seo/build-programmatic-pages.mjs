#!/usr/bin/env node
/**
 * Programmatic SEO page generator for /gifts/[slug] URLs.
 *
 * Generates one HTML file per (occasion × relationship) cell. Every cell
 * has unique content authored by hand — no slot-fill — to avoid Google's
 * Helpful Content / doorway-page demotion.
 *
 * Each generated page includes:
 *   - All standard meta tags (description, OG, Twitter, canonical)
 *   - JSON-LD: Service, BreadcrumbList, HowTo, FAQPage
 *   - Unique hero, 3-step HowTo, "why this combo", "best for moments",
 *     example lyric block, FAQ, and internal links
 *   - CTA to /download with UTM tagged per cell
 *
 * Output: public/gifts/[slug].html + updated public/sitemap.xml
 *
 * Run:  node scripts/seo/build-programmatic-pages.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "public", "gifts");
const SITEMAP = path.join(ROOT, "public", "sitemap.xml");

const SITE_BASE = "https://porizo.co";
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// CELL DATA — one entry per generated page. Hand-authored unique content.
// ---------------------------------------------------------------------------

const CELLS = [
  // ============================================================
  // FATHER'S DAY (seasonal urgent — June 15)
  // ============================================================
  {
    slug: "fathers-day-song-for-dad",
    metaTitle: "Father's Day Song for Dad | Porizo",
    metaDescription:
      "Make a personalized Father's Day song for Dad — original lyrics from a real memory, sung in your own voice. A finished song in about three minutes.",
    eyebrow: "Father's Day song for dad",
    h1: "Make a Father's Day song he'll keep.",
    lede:
      "Porizo turns one real memory of your dad — the song he sang in the car, the joke he never stops telling, the thing he taught you — into an original Father's Day song. Sung in your own voice, finished in about three minutes.",
    cardTag: "For Dad — Father's Day",
    cardTitle: "The Way He Drove the Sundays",
    cardLyric:
      '"You taught me everything except how to say it back — so I put it in a song this time."',
    whyEyebrow: "Why Porizo for Father's Day",
    whyHeadline: "A Father's Day gift built around <em>him</em>, not the calendar.",
    whyBody:
      'Most Father\'s Day gifts say "I remembered." A Porizo song says "I remembered <em>this</em> about you" — the specific Saturday morning he taught you to ride a bike, the verse he sings from memory, the way he answers the phone. Those become the heart of the lyric, then Porizo sings them back in your own voice via voice cloning. Among the established personalized-song gift services (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter. Your dad hears a song that was made *for* him, in the voice he raised. Available on Plus and Pro after a one-time voice enrollment.',
    bestForEyebrow: "Best for",
    bestForHeadline: "Father's Day moments that earn their own song.",
    bestForMoments: [
      "<strong>Milestone Father's Days.</strong> 50, 60, 70 — the years where a card or a tie just doesn't carry it.",
      "<strong>The first Father's Day apart.</strong> He moved cities, you moved cities, or he's been gone too long. A song crosses the distance instantly.",
      "<strong>A dad who has everything.</strong> The man who refuses gifts but plays the same five songs on repeat. Add yours to that list.",
      "<strong>The Father's Day after a hard year.</strong> Health, grief, distance, transition. A song says what the year made you realize.",
      "<strong>A surprise at the family dinner.</strong> Hand him the phone after dessert. Watch his face when he hears your voice singing words you couldn't say at the table.",
      "<strong>The dad who became a granddad.</strong> A song that names the grandkid and the dad in the same lyric. Two generations in 75 seconds.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one Saturday morning to a full Father's Day song.",
    exampleStarRow: "For a dad's 65th, Father's Day",
    exampleLyric:
      '"You taught me how to drive on a Sunday road / told me the brake was kinder than the wheel / and every time I borrow your jacket / I find another year you carried me through."',
    exampleStyle:
      "Acoustic folk · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric above came from one detail: "Dad insisted I learn to drive on Sundays — empty roads, no traffic." Porizo turned that single sentence into a verse, a chorus, and a bridge, then sang it back in the gifter\'s tone.',
    faqEyebrow: "FAQ",
    faqHeadline: "Father's Day song questions.",
    faqs: [
      {
        q: "How fast can I make a Father's Day song? It's almost Father's Day.",
        a: "Preview in under 90 seconds. Full 45–90 second song in about three minutes. You can finish the song this morning and send it before dinner.",
      },
      {
        q: "Will Dad hear it in my voice?",
        a: "Yes — voice cloning is included on Plus and Pro plans. After a one-time recording of 6–10 short phrases, Porizo sings every song in your own voice. This is the feature that makes a Father's Day song land harder than any card.",
      },
      {
        q: "What if my dad isn't really into music?",
        a: "The song is short (under 90 seconds), specific to him, and shared as a link he can open once and never feel obligated to revisit. Most non-music dads keep it anyway. The reason is the specificity — it's about him, not about music.",
      },
      {
        q: "Can I make a Father's Day song for my stepdad / father-in-law?",
        a: "Yes. Porizo handles any father figure: dad, stepdad, father-in-law, grandfather, foster dad, godfather. The lyric is built from the relationship you describe.",
      },
      {
        q: "How does this compare to Songfinch for Father's Day?",
        a: "Songfinch uses human composers and ships in around 4–7 days for $179.99–$199.99 (rush options extra). Excellent if Father's Day is two weeks out. Porizo ships in minutes for $9.99/month and adds voice cloning, which Songfinch cannot do. Different tools for different Father's Days.",
      },
      {
        q: "Can my dad share it with family?",
        a: "Yes — by default. The song generates a web link that plays in any browser, no app required. Pro adds 'share with anyone' so he can play it on any device, send it to siblings, or post it to his group chats.",
      },
    ],
    internalLinks: [
      { url: "/blog/fathers-day-song-gift-personalized", text: "A personalized gift Dad will actually keep" },
      { url: "/fathers-day-song", text: "Father's Day song landing page" },
      { url: "/gifts/fathers-day-song-for-stepdad", text: "Father's Day song for stepdad" },
    ],
    utmCampaign: "fathers_day_for_dad",
  },

  {
    slug: "fathers-day-song-for-stepdad",
    metaTitle: "Father's Day Song for Stepdad | Porizo",
    metaDescription:
      "A personalized Father's Day song for your stepdad — built around the moments only you two share. Original lyrics, your voice, finished in minutes.",
    eyebrow: "Father's Day song for stepdad",
    h1: "Father's Day, the way a stepdad earns one.",
    lede:
      "Some stepdads showed up and stayed. A Porizo song captures the specific way he made room for you — the inside jokes, the patience, the things he taught without making it a lesson. Original lyrics, sung in your own voice, finished in about three minutes.",
    cardTag: "For Stepdad — Father's Day",
    cardTitle: "The Quiet One Who Stayed",
    cardLyric:
      '"You didn\'t have to be here / but you stayed long enough to teach me what \'here\' looks like."',
    whyEyebrow: "Why Porizo for stepdad's Father's Day",
    whyHeadline: "The song says the thing 'Happy Father's Day' can't.",
    whyBody:
      "Stepdads sit in an awkward seat on Father's Day. A generic card feels too small. A heartfelt note feels too vulnerable to hand over. A Porizo song does what a card can't: it names the moment <em>he</em> earned the title — the day he showed up at the school play, the first time he called you on your birthday without being prompted, the way he handles your mom when she's tired. Those become the lyric, sung in your voice via voice cloning. None of the established human-composer gift services (Songfinch, Songlorious) offer voice cloning. He hears the song. He recognizes your voice. He knows it's real.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Stepdad moments that earn their own song.",
    bestForMoments: [
      "<strong>The first Father's Day after he and your mom married.</strong> The acknowledgment he didn't ask for but deserves.",
      "<strong>The first Father's Day after he stepped up.</strong> The year something hard happened and he was steady through it.",
      "<strong>A milestone — 5, 10, 20 years.</strong> Marking the time he stayed.",
      "<strong>An adult stepdad relationship.</strong> When the relationship became real after the marriage ended, after the kids grew up, after the dust settled.",
      "<strong>A stepdad who is also a grandfather.</strong> A song that names what he is to your kids, too.",
      "<strong>A surprise after years of silence on Father's Day.</strong> If you've never made a thing of it before — this is the year.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one specific 'he showed up' to a song.",
    exampleStarRow: "For a stepdad — 15 years in",
    exampleLyric:
      '"You came to the play that wasn\'t yours to see / you fixed the bike that wasn\'t yours to fix / you taught me what an adult looks like when nobody owes anybody anything / and you stayed."',
    exampleStyle: "Folk · 80 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric above came from one memory: "He came to my fifth-grade school play even though my mom was working." Porizo built a verse and chorus around that single moment.',
    faqEyebrow: "FAQ",
    faqHeadline: "Stepdad Father's Day song questions.",
    faqs: [
      {
        q: "Is it weird to give my stepdad a Father's Day song?",
        a: "If you've been thinking about whether to acknowledge him on Father's Day, that thought is already the answer. The song lets you say what feels too vulnerable in a card. Most stepdads keep these gifts permanently.",
      },
      {
        q: "What if our relationship is complicated?",
        a: "The lyric works from whatever you give it. You don't have to pretend things are simpler than they are. Many of the most-played Porizo songs for stepdads are about the specific way he showed up — not about the bigger relationship.",
      },
      {
        q: "Can I make it sound like me singing?",
        a: "Yes — voice cloning is included on Plus and Pro. After a one-time voice enrollment, Porizo sings every song in your own voice. Hearing your voice is part of what makes this land for him.",
      },
      {
        q: "How quickly can I do this — Father's Day is days away?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song this morning and send it before dinner.",
      },
      {
        q: "Should I send it to him privately or play it at the family gathering?",
        a: "Most people send it privately first — by text, by email, by a quiet moment after dessert — so he can hear it alone before he has to react in front of anyone. Then play it later if the moment fits.",
      },
      {
        q: "What if I want to include something about him being a grandfather to my kids?",
        a: "Mention it in the memory you give Porizo. The lyric will weave both layers — what he was to you and what he is to your kids — into the same song.",
      },
    ],
    internalLinks: [
      { url: "/gifts/fathers-day-song-for-dad", text: "Father's Day song for dad" },
      { url: "/blog/fathers-day-song-gift-personalized", text: "Personalized Father's Day song gift" },
      { url: "/fathers-day-song", text: "Father's Day song overview" },
    ],
    utmCampaign: "fathers_day_for_stepdad",
  },

  {
    slug: "fathers-day-song-for-grandpa",
    metaTitle: "Father's Day Song for Grandpa | Porizo",
    metaDescription:
      "Personalized Father's Day song for Grandpa. Original lyrics from a real grandkid memory, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Father's Day song for grandpa",
    h1: "Make Grandpa a Father's Day song.",
    lede:
      "Grandpas get cards. Grandpas get phone calls. Grandpas almost never get a song. A Porizo Father's Day song captures one specific thing about him — the workshop in the garage, the recipe he protects, the story he tells every Christmas — and sings it back in your voice. Finished in about three minutes.",
    cardTag: "For Grandpa — Father's Day",
    cardTitle: "The Workshop and the Word for Patience",
    cardLyric:
      '"You measured twice / you taught me what twice meant / and the third time was always for the family."',
    whyEyebrow: "Why Porizo for Grandpa's Father's Day",
    whyHeadline: "Most Father's Day gifts skip the grandfather. This one finds him first.",
    whyBody:
      "Grandfathers are the most overlooked recipient of Father's Day. The kids buy for Dad. The grandkids buy a card, maybe a phone call. A Porizo song flips that — it makes the grandfather the headline of the day. It captures the specific way he showed up across generations: the workshop, the kitchen, the early-morning fishing trip, the time he taught you the right way to shake someone's hand. Sung in your own voice via voice cloning, so when he plays it he hears <em>you</em> — not a stranger, not a singer. That recognition is the gift.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Grandpa moments that earn their own song.",
    bestForMoments: [
      "<strong>A milestone Father's Day for a grandfather.</strong> 70, 75, 80, 85 — when fewer people make it a thing.",
      "<strong>A great-grandfather.</strong> A song that names four generations in one verse.",
      "<strong>The first Father's Day after a health scare.</strong> The year you don't take for granted.",
      "<strong>A grandfather who raised you.</strong> When 'grandpa' means more than the title — make the song say it.",
      "<strong>A long-distance grandfather.</strong> Different state, different country. The link crosses the distance instantly.",
      "<strong>The grandfather who is quiet about Father's Day.</strong> The man who waves it off every year. Make this the one he can't wave off.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one fishing trip to a full Father's Day song.",
    exampleStarRow: "For a grandpa — 80th Father's Day",
    exampleLyric:
      '"You took me out on the still cold water / told me to listen to the line / and forty years later I still hear it / when the world gets noisy I remember the line."',
    exampleStyle: "Country · 70 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "Grandpa took me fishing at 5am and told me to be quiet." Porizo turned that into a verse, a chorus about listening, and a closing image of using the lesson in adulthood.',
    faqEyebrow: "FAQ",
    faqHeadline: "Grandpa Father's Day song questions.",
    faqs: [
      {
        q: "Will my grandfather know how to play a web link?",
        a: "Open the link on your phone, hand him the phone, hit play. The song plays in the browser — no app, no install, no account. If he's playing voice messages on the family group chat, he'll handle this fine.",
      },
      {
        q: "Can the grandkids' names be in the song?",
        a: "Yes — include them in the memory you describe. The lyric will weave names into the verse naturally.",
      },
      {
        q: "What if my grandfather is hard of hearing?",
        a: "Porizo lets you preview and re-render the song with different genres. Slower acoustic styles tend to be easier to follow. You can also share the lyric text alongside the audio.",
      },
      {
        q: "How long is the song? Can it be longer for a milestone?",
        a: "Songs are 45–90 seconds. For an 80th or 90th birthday Father's Day, the under-90-seconds length actually works in your favor — long enough to land, short enough to play three times in a row.",
      },
      {
        q: "Can I make it sound like the grandkid singing — not me?",
        a: "Voice cloning uses the enrolled voice. If you enroll the grandkid's voice (with permission for a minor), the song sings in their voice. Most gifters enroll themselves and the grandkid as separate profiles.",
      },
      {
        q: "How does this compare to Songfinch for a grandfather gift?",
        a: "Songfinch uses human composers and ships in around 4–7 days for $179.99+. Porizo ships in minutes for $9.99/month and adds voice cloning. For a grandfather who might not have many more Father's Days, the speed and the voice-recognition matter.",
      },
    ],
    internalLinks: [
      { url: "/gifts/fathers-day-song-for-dad", text: "Father's Day song for dad" },
      { url: "/gifts/birthday-song-for-grandpa", text: "Birthday song for grandpa" },
      { url: "/fathers-day-song", text: "Father's Day song overview" },
    ],
    utmCampaign: "fathers_day_for_grandpa",
  },

  // ============================================================
  // BIRTHDAY × GRANDPARENT (evergreen long-tail)
  // ============================================================
  {
    slug: "birthday-song-for-grandma",
    metaTitle: "Birthday Song for Grandma | Porizo",
    metaDescription:
      "A personalized birthday song for Grandma — original lyrics about her, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Birthday song for grandma",
    h1: "Make Grandma a birthday song.",
    lede:
      "Grandmas remember every birthday. Make sure this one remembers her. Porizo turns one specific thing about your grandma — her garden, her phone voice, the way she keeps your school photos on the fridge twenty years later — into a song. Sung in your voice. Finished in about three minutes.",
    cardTag: "For Grandma — Birthday",
    cardTitle: "The Voice That Always Sounded Surprised",
    cardLyric:
      '"Every time I called you said \'oh!\' / like the phone ringing was always a small miracle / and I never told you I waited for that sound."',
    whyEyebrow: "Why Porizo for Grandma's birthday",
    whyHeadline: "Grandma's birthday gift, finally caught up with how you actually feel.",
    whyBody:
      "Grandma birthdays are easy to default on. Flowers. Box of chocolates. A phone call from the airport. A Porizo song breaks the pattern by being <em>specific</em> — about her garden, the way she answers the phone, the recipe she only makes for you, the song she always sings off-key. Those become the lyric. Then Porizo sings it back in your own voice via voice cloning, so when she plays it she hears <em>you</em>. That recognition is the gift. None of the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) offer voice cloning of the gifter.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Grandma birthdays that earn their own song.",
    bestForMoments: [
      "<strong>A milestone birthday.</strong> 70, 75, 80, 85, 90 — the years that quietly matter more.",
      "<strong>A great-grandma's birthday.</strong> A song that names four generations in one verse.",
      "<strong>A first birthday after a hard year.</strong> Health, loss, distance. A song that says the thing you couldn't say at Christmas.",
      "<strong>A long-distance grandma.</strong> Different country, different decade of phone calls. The link crosses everything instantly.",
      "<strong>A grandma who raised you.</strong> When grandma means more than the title — make the song say it.",
      "<strong>The grandma who hates a fuss.</strong> The one who says 'oh, don't.' This is the one she'll quietly play forty times.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one phone call to a full birthday song.",
    exampleStarRow: "For a grandma's 80th",
    exampleLyric:
      '"You answered every call like the phone surprised you / you kept my photos on the fridge for twenty years / you taught me what stays — and what stays doesn\'t leave when you ask it to."',
    exampleStyle: "Folk ballad · 70 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "Grandma always answered the phone surprised, like she couldn\'t believe I was calling." Porizo built a verse around that and a chorus about what she taught you about staying.',
    faqEyebrow: "FAQ",
    faqHeadline: "Grandma birthday song questions.",
    faqs: [
      {
        q: "How does my grandma play this? Does she need an app?",
        a: "No. The song is a web link. Open it on your phone, hand it to her, hit play. It plays in the browser. If she's used FaceTime once, she'll handle this fine.",
      },
      {
        q: "Can I make it sound like me singing?",
        a: "Yes — voice cloning is included on Plus and Pro. After enrolling your voice (6–10 short phrases, once), Porizo sings every song in your own voice. For a grandma birthday, hearing your voice is the part that hits.",
      },
      {
        q: "What if multiple grandkids want to give the song together?",
        a: "Use the enrolled voice of one grandkid. Then mention all the grandkids' names in the memory you describe — the lyric will weave them in. Or enroll each grandkid separately and make a different song from each.",
      },
      {
        q: "How long is the song? Can I make it longer for a 90th?",
        a: "Songs are 45–90 seconds. For a milestone, that length is right — long enough to land, short enough that she plays it three times in a row.",
      },
      {
        q: "Can I send it before the party so she hears it alone first?",
        a: "Yes — recommended. Most grandmas appreciate hearing it privately before any public moment. Then play it at the party if the moment fits.",
      },
      {
        q: "How does this compare to Songfinch for a grandma birthday?",
        a: "Songfinch uses human composers and ships in 4–7 days for $179.99+. Porizo ships in minutes for $9.99/month and adds voice cloning. For a grandma birthday where the moment matters now, the speed and the voice recognition matter.",
      },
    ],
    internalLinks: [
      { url: "/gifts/birthday-song-for-grandpa", text: "Birthday song for grandpa" },
      { url: "/birthday-song-maker", text: "Birthday song maker" },
      { url: "/blog/birthday-song-gift-ideas", text: "Birthday song gift ideas" },
    ],
    utmCampaign: "birthday_for_grandma",
  },

  {
    slug: "birthday-song-for-grandpa",
    metaTitle: "Birthday Song for Grandpa | Porizo",
    metaDescription:
      "Personalized birthday song for Grandpa — original lyrics built around the way he actually shows up. Sung in your voice. Finished in minutes.",
    eyebrow: "Birthday song for grandpa",
    h1: "Make Grandpa a birthday song.",
    lede:
      "Grandpas don't ask for much on their birthday. That's part of why the song works — it's the gift he didn't ask for. Porizo captures one specific thing about him — the workshop, the recipe, the way he answers when you call — and turns it into an original song, sung in your voice.",
    cardTag: "For Grandpa — Birthday",
    cardTitle: "The Workshop Light Was Always On",
    cardLyric:
      '"You measured twice / you cut once / and you let me hand you the tools wrong for as long as it took."',
    whyEyebrow: "Why Porizo for Grandpa's birthday",
    whyHeadline: "The birthday song that finds the specific grandfather, not the category.",
    whyBody:
      "Grandfather birthday gifts default to a category — fishing, golf, woodworking, history books. A Porizo song flips the script: it finds the <em>specific</em> grandfather, not the type. The early-morning coffee. The story he tells every Thanksgiving. The lesson he repeats every Sunday. Those become the lyric. Sung in your voice via voice cloning, which means when he plays it he hears <em>you</em>, not a singer. Among the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none offer this.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Grandpa birthdays that earn their own song.",
    bestForMoments: [
      "<strong>A milestone birthday.</strong> 70, 75, 80, 85, 90 — the years that quietly matter more.",
      "<strong>A great-grandfather.</strong> A song that names four generations.",
      "<strong>A first birthday after a health scare.</strong> The year you don't take for granted.",
      "<strong>A grandfather who raised you.</strong> When grandpa means more than the title.",
      "<strong>The grandfather who waves off birthdays.</strong> The one who says 'don't make a thing of it.' This is the year you do.",
      "<strong>A long-distance grandfather.</strong> Different state, different generation of phone calls. The link crosses everything instantly.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one Saturday in the workshop to a full song.",
    exampleStarRow: "For a grandpa's 85th",
    exampleLyric:
      '"You measured twice and cut once / you let me hand you the wrong wrench for years / and you taught me what care looks like when nobody\'s watching."',
    exampleStyle: "Country · 70 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: \"Grandpa let me 'help' in the workshop even though I was useless.\" Porizo built a verse around the patience and a chorus about quiet care.",
    faqEyebrow: "FAQ",
    faqHeadline: "Grandpa birthday song questions.",
    faqs: [
      {
        q: "How does my grandpa play the song? Does he need an app?",
        a: "No. The song is a web link. Open it on your phone, hand it to him, hit play. It plays in the browser. If he's used a voicemail this decade, he'll be fine.",
      },
      {
        q: "Can I make it sound like me singing?",
        a: "Yes — voice cloning is included on Plus and Pro. Record 6–10 short phrases once and Porizo will sing every song in your own voice.",
      },
      {
        q: "What if my grandfather isn't a music guy?",
        a: "Most grandfathers who 'don't really listen to music' keep these songs anyway. The reason is the specificity — it's about him, not about music.",
      },
      {
        q: "Can multiple grandkids give the song together?",
        a: "Use one enrolled voice and mention all the grandkids' names in the memory. Or enroll each grandkid separately and make a different version of the same song.",
      },
      {
        q: "Can I include the great-grandkids in the lyric?",
        a: "Yes. Include them in the memory you describe. The lyric will weave the names across generations.",
      },
      {
        q: "What if I want to give the song privately, not at a party?",
        a: "Most birthdays end up that way. Send it as a text the morning of his birthday. Let him hear it alone first. The reaction you get back is usually quieter than a party and twice as real.",
      },
    ],
    internalLinks: [
      { url: "/gifts/birthday-song-for-grandma", text: "Birthday song for grandma" },
      { url: "/gifts/fathers-day-song-for-grandpa", text: "Father's Day song for grandpa" },
      { url: "/birthday-song-maker", text: "Birthday song maker" },
    ],
    utmCampaign: "birthday_for_grandpa",
  },

  // ============================================================
  // ANNIVERSARY (high commercial intent)
  // ============================================================
  {
    slug: "anniversary-song-for-wife",
    metaTitle: "Anniversary Song for Wife | Porizo",
    metaDescription:
      "Personalized anniversary song for your wife — original lyrics from a real memory, sung in your voice. Finished in about three minutes.",
    eyebrow: "Anniversary song for wife",
    h1: "Anniversary song for your wife.",
    lede:
      "The flowers wilt. The card disappears. A Porizo anniversary song catches one specific thing about her — the laugh, the way she says your name when she's tired, the joke from the third date — and turns it into a song. Sung in your own voice. Finished in about three minutes.",
    cardTag: "Anniversary — for her",
    cardTitle: "Still the Reason",
    cardLyric:
      '"You still wake up the way you did that morning / I still don\'t know how I got this lucky / and the years didn\'t answer the question — they just made it bigger."',
    whyEyebrow: "Why Porizo for your anniversary",
    whyHeadline: "An anniversary gift that doesn't sound like everyone else's.",
    whyBody:
      "Anniversary gifts blur together. Flowers, dinner reservation, jewelry-store ad. A Porizo song breaks out of that by being <em>about her specifically</em> — the laugh you fell for, the apartment with the broken radiator, the running joke about pancakes, the thing she said the day you knew. Those become the lyric. Then Porizo sings them back in your own voice via voice cloning — the voice she actually fell for. Among the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter. She hears the song and recognizes <em>you</em> singing — that recognition is the gift.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Anniversaries that earn their own song.",
    bestForMoments: [
      "<strong>A milestone anniversary.</strong> 1st (paper), 5th, 10th, 25th (silver), 50th (gold) — the years that get remembered out loud.",
      "<strong>A surprise after a hard year.</strong> The year that almost broke you. The song that says you stayed.",
      "<strong>A long-distance anniversary.</strong> Travel, deployment, sick parent. A song that crosses the distance instantly.",
      "<strong>A second-marriage anniversary.</strong> When the year matters in a different way. A song that names it.",
      "<strong>An anniversary alone.</strong> If she's traveling or you are, the song lands the same — in her ears, in her voice memo replays, anywhere.",
      "<strong>The 'forgot to plan something' anniversary.</strong> Three minutes from open-app to finished song. The save.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one September morning to a 25th anniversary song.",
    exampleStarRow: "For a 25th wedding anniversary",
    exampleLyric:
      '"Twenty-five Septembers / and you still hum the same way over coffee / you still answer my one bad joke / and somehow the same morning gets new each time."',
    exampleStyle: "Acoustic · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "She hums when she pours coffee, the same way she did our first morning together." Porizo wrote a verse and chorus around that and stacked twenty-five years onto it.',
    faqEyebrow: "FAQ",
    faqHeadline: "Anniversary song questions.",
    faqs: [
      {
        q: "What if our anniversary is tonight?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song in the time it takes her to get dressed.",
      },
      {
        q: "Will the song be in my own voice?",
        a: "Yes — voice cloning is included on Plus and Pro. Record 6–10 short phrases once and Porizo will sing every future song in your voice. For an anniversary song, hearing your voice is what makes it land.",
      },
      {
        q: "What if I don't know what to say in the song?",
        a: "Give Porizo one specific thing about her — a memory, a phrase you use together, an inside joke, a moment from the year. One detail is enough; the lyric grows from there.",
      },
      {
        q: "Can I include our anniversary date or the number of years in the song?",
        a: "Yes — mention it in the memory or message you describe. The lyric will weave the date or year-count in naturally.",
      },
      {
        q: "How is this different from making her a Spotify playlist?",
        a: "A playlist says 'I picked these songs for you.' A Porizo song says 'this song does not exist anywhere else — it was written for you, sung by me, three minutes ago.' Different category of gift.",
      },
      {
        q: "How does this compare to Songfinch or Songlorious?",
        a: "Songfinch and Songlorious use human composers and ship in days for $169.99–$199.99 per song. Porizo ships in minutes for $9.99/month and adds voice cloning — the gifter's own voice singing — which neither offers.",
      },
    ],
    internalLinks: [
      { url: "/gifts/anniversary-song-for-husband", text: "Anniversary song for husband" },
      { url: "/gifts/anniversary-song-25-years", text: "25th anniversary song" },
      { url: "/anniversary-song-gift", text: "Anniversary song gift overview" },
    ],
    utmCampaign: "anniversary_for_wife",
  },

  {
    slug: "anniversary-song-for-husband",
    metaTitle: "Anniversary Song for Husband | Porizo",
    metaDescription:
      "Personalized anniversary song for your husband — original lyrics from a real shared moment, sung in your voice. Finished in about three minutes.",
    eyebrow: "Anniversary song for husband",
    h1: "Anniversary song for your husband.",
    lede:
      "Husbands are notoriously hard to shop for on the anniversary. A Porizo song fixes that by being <em>about him</em> — the way he makes coffee, the line you say every December, the inside joke from the road trip — turned into a song sung in your voice. Finished in about three minutes.",
    cardTag: "Anniversary — for him",
    cardTitle: "The Long Quiet Yes",
    cardLyric:
      '"You said yes ten thousand small times / before the year I learned to say thank-you out loud / so here it is in a song instead."',
    whyEyebrow: "Why Porizo for your anniversary",
    whyHeadline: "An anniversary gift built for a man who doesn't want stuff.",
    whyBody:
      "Husbands tend to refuse gifts on the anniversary. 'Don't get me anything.' A Porizo song slips past that defense because it isn't a thing — it's a moment, captured in lyric, in your voice. The way he makes coffee. The thing he says when you're tired. The joke from the third year. Those become the song. Then Porizo sings it back in <em>your voice</em> via voice cloning — the voice he wakes up to. Among the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter. He hears the song. He recognizes you singing. He keeps it.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Anniversaries that earn their own song.",
    bestForMoments: [
      "<strong>A milestone.</strong> 1, 5, 10, 25, 50 — the years that quietly mark a chapter.",
      "<strong>A surprise after the hard year.</strong> The year work was a lot, kids were a lot, life was a lot. The song that says you noticed him through it.",
      "<strong>A long-distance anniversary.</strong> Travel, deployment, family stuff. A song that crosses the distance instantly.",
      "<strong>The 'we don't really do anniversaries' anniversary.</strong> Surprise him with one short, specific thing.",
      "<strong>A second-marriage anniversary.</strong> When the year matters in a particular way.",
      "<strong>A retirement-era anniversary.</strong> A song about the decades that came before this new chapter.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one inside joke to a 10th anniversary song.",
    exampleStarRow: "For a 10th wedding anniversary",
    exampleLyric:
      `"You still make coffee like the kitchen is yours alone / you still text \"on my way\" from two blocks out / and ten years of the same one inside joke / has somehow turned into the love song I didn't know I was writing."`,
    exampleStyle: "Indie folk · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "He texts \'on my way\' from two blocks from home, every single day." Porizo wrote a verse around the ritual and a chorus about ten years of small loyalties.',
    faqEyebrow: "FAQ",
    faqHeadline: "Anniversary song questions.",
    faqs: [
      {
        q: "What if our anniversary is tonight?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song in the time it takes him to find his keys.",
      },
      {
        q: "Will the song be in my own voice?",
        a: "Yes — voice cloning is included on Plus and Pro. Record 6–10 short phrases once and Porizo will sing every future song in your voice. For a husband's anniversary gift, your voice is the thing that lands it.",
      },
      {
        q: "He says he doesn't want gifts. Will this still work?",
        a: "Yes. Husbands who refuse gifts almost always keep these songs anyway. The reason is it's not a thing — it's a moment. He's not turning down a moment.",
      },
      {
        q: "Can I include our kids' names?",
        a: "Yes. Mention them in the memory or message you describe. The lyric will weave them in.",
      },
      {
        q: "How is this different from a playlist?",
        a: "A playlist says 'I curated these.' A Porizo song says 'this lyric does not exist anywhere else — it was written for you, sung by me, three minutes ago.' Different category of gift.",
      },
      {
        q: "How does this compare to Songfinch or Songlorious?",
        a: "Songfinch and Songlorious use human composers and ship in days for $169.99–$199.99 per song. Porizo ships in minutes for $9.99/month and adds voice cloning — your own voice singing — which neither offers.",
      },
    ],
    internalLinks: [
      { url: "/gifts/anniversary-song-for-wife", text: "Anniversary song for wife" },
      { url: "/gifts/anniversary-song-25-years", text: "25th anniversary song" },
      { url: "/anniversary-song-gift", text: "Anniversary song gift overview" },
    ],
    utmCampaign: "anniversary_for_husband",
  },

  {
    slug: "anniversary-song-25-years",
    metaTitle: "25th Anniversary Song (Silver Anniversary) | Porizo",
    metaDescription:
      "Personalized 25th anniversary song. Original lyrics about your 25 years, sung in your own voice. Finished in about three minutes.",
    eyebrow: "25th anniversary song",
    h1: "A 25th anniversary song, the way 25 years deserve.",
    lede:
      "Twenty-five years is silver because silver lasts. A card or a watch can't carry 25 years of inside jokes. A Porizo silver-anniversary song catches one specific moment that ran through every year — the way she pours coffee, the way he says your name — and turns it into a song, sung in your voice.",
    cardTag: "25th — Silver",
    cardTitle: "Twenty-Five Septembers",
    cardLyric:
      '"Twenty-five Septembers / and you still find the one window where the light hits right / and you still pretend you weren\'t waiting for me to walk in."',
    whyEyebrow: "Why Porizo for the 25th",
    whyHeadline: "A silver anniversary gift, the way silver actually means.",
    whyBody:
      "Silver anniversary gifts usually default to silver-as-metal: jewelry, a frame, a watch. The intent is real but the gift is generic. A Porizo silver-anniversary song does what silver actually means: it preserves <em>this specific 25 years</em> — your inside jokes, the way you've made coffee for each other, the running argument about a movie title that's lasted two decades. Those become the lyric, sung back in your own voice via voice cloning. None of the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) offer voice cloning of the gifter. Twenty-five years of you, in a song that didn't exist three minutes ago.",
    bestForEyebrow: "Best for",
    bestForHeadline: "25th anniversary moments that earn their own song.",
    bestForMoments: [
      "<strong>A surprise at the silver-anniversary dinner.</strong> Hand them the phone before dessert.",
      "<strong>A surprise renewal of vows.</strong> The song as the moment after.",
      "<strong>A 'we said we wouldn't make a thing' 25th.</strong> The quiet song that lands harder than a party.",
      "<strong>A 25th apart.</strong> Travel, family, work. The song crosses the distance instantly.",
      "<strong>A long-distance 25th.</strong> Different cities, different time zones. Song hits both sides at once.",
      "<strong>The 25th after a hard chapter.</strong> The year you got through. The song that says you did.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one September detail to a 25th anniversary song.",
    exampleStarRow: "For a 25th wedding anniversary",
    exampleLyric:
      '"Twenty-five Septembers / I have watched you find the window where the light hits right / and I will keep walking in pretending I didn\'t notice you waiting / for another twenty-five Septembers."',
    exampleStyle: "Acoustic · 80 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "She always sits in the same spot by the window at our anniversary breakfast." Porizo built the whole song around that 25-September ritual.',
    faqEyebrow: "FAQ",
    faqHeadline: "25th anniversary song questions.",
    faqs: [
      {
        q: "What's the right tone for a 25th anniversary song — joyful or reflective?",
        a: "Both work. Porizo lets you choose the genre — acoustic ballad for reflective, pop for joyful, country for storytelling. You can preview multiple genres before committing.",
      },
      {
        q: "Can the song mention specific years or moments from our 25 years?",
        a: "Yes — that's what makes it land. Include any years, places, names, or moments in the memory you give Porizo. The lyric will weave them in.",
      },
      {
        q: "Will the song be in my own voice?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and every song after that is in your voice. For a 25th, that detail is what makes the song outlive the dinner.",
      },
      {
        q: "How long is the song? Can I make it longer for a milestone?",
        a: "Songs are 45–90 seconds. For a 25th, that length actually serves you — long enough to land in front of family, short enough to play three times during dinner.",
      },
      {
        q: "Can I make multiple songs — one for each of us?",
        a: "Yes — and many people do for a 25th. Each spouse enrolls their voice and writes a song to the other. Two songs, two voices, one anniversary.",
      },
      {
        q: "How does this compare to Songfinch for a 25th?",
        a: "Songfinch uses human composers and ships in 4–7 days for $179.99+. Porizo ships in minutes for $9.99/month and adds voice cloning. For a 25th anniversary, hearing your own voice (or your spouse's) sing the lyric is the part Songfinch can't deliver.",
      },
    ],
    internalLinks: [
      { url: "/gifts/anniversary-song-for-wife", text: "Anniversary song for wife" },
      { url: "/gifts/anniversary-song-for-husband", text: "Anniversary song for husband" },
      { url: "/anniversary-song-gift", text: "Anniversary song gift overview" },
    ],
    utmCampaign: "anniversary_25_years",
  },

  // ============================================================
  // GRADUATION (May-June seasonal)
  // ============================================================
  {
    slug: "graduation-song-for-son",
    metaTitle: "Graduation Song for Son | Porizo",
    metaDescription:
      "Personalized graduation song for your son — original lyrics about him, sung in your voice. Finished in about three minutes.",
    eyebrow: "Graduation song for son",
    h1: "Graduation song for your son.",
    lede:
      "He won't read the card. He might not even open the envelope. But he'll play a song. A Porizo graduation song catches one specific thing about who your son is right now — the joke, the focus, the way he disappears into a project — and turns it into a song, sung in your own voice.",
    cardTag: "Graduation — for him",
    cardTitle: "The Long Slow Yes",
    cardLyric:
      '"You worked it out the long way / you said yes to one quiet hour after another / and now the years are clapping for you."',
    whyEyebrow: "Why Porizo for graduation",
    whyHeadline: "A graduation gift he'll actually keep.",
    whyBody:
      "Graduation gifts default to cash, watches, or framed degrees. None of them sit on the playlist. A Porizo song does — because it's specific to him. The way he studied. The thing he said when something hard finally clicked. The teacher he never thanked out loud. Those become the lyric, sung in your own voice via voice cloning, which means when he plays it on the drive home from the ceremony he hears <em>you</em>. Among the established human-composer gift services (Songfinch, Songlorious) none offer voice cloning of the gifter. He keeps the song. He plays it again at his first job interview, his first apartment, his first big break.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Graduation moments that earn their own song.",
    bestForMoments: [
      "<strong>High-school graduation.</strong> The first big chapter. A song that names the years before.",
      "<strong>College graduation.</strong> The years that cost him something. A song that says you saw it.",
      "<strong>A trade-school or apprenticeship completion.</strong> The work that doesn't get the same fanfare. This is the song that gives it the fanfare.",
      "<strong>A graduate school completion.</strong> Master's, JD, MD. The longer years. The harder song to write.",
      "<strong>A return-to-school graduation.</strong> If he went back at 30, 40, 50. The song that says it took courage and time.",
      "<strong>A surprise after the ceremony.</strong> Play it on the drive home. Watch his face.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one late-night detail to a full graduation song.",
    exampleStarRow: "For a son's college graduation",
    exampleLyric:
      '"You read the chapter twice and you didn\'t complain / you turned the lamp off late and you didn\'t say why / and now the long quiet hours are walking across this stage with you."',
    exampleStyle: "Acoustic · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "He used to study with one lamp on, late, with the door cracked." Porizo built the song around that single image of focus.',
    faqEyebrow: "FAQ",
    faqHeadline: "Graduation song questions.",
    faqs: [
      {
        q: "Will my son actually like this?",
        a: "Most graduates 'don't really listen to that kind of music' and play these anyway. The reason is the specificity. It's not about music — it's about him.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and Porizo sings every song in your voice. For a graduation song from a parent, that's the part that lands.",
      },
      {
        q: "Can I include his school's name or his major?",
        a: "Yes. Include them in the memory or message you describe. The lyric will weave them in.",
      },
      {
        q: "When should I give it to him?",
        a: "Most people send the link the morning of the ceremony, so he can play it once on his way there and once on the drive home. Some give it at the graduation dinner.",
      },
      {
        q: "Can multiple family members contribute?",
        a: "Yes. Each enrolls their voice and makes a song. Or one person makes the song and lists each family member by name in the memory — the lyric weaves them in.",
      },
      {
        q: "How does this compare to Songfinch?",
        a: "Songfinch uses human composers and ships in 4–7 days for $179.99+. Porizo ships in minutes for $9.99/month and adds voice cloning. For graduation, the voice-recognition is what makes a parent-to-child song land.",
      },
    ],
    internalLinks: [
      { url: "/gifts/graduation-song-for-daughter", text: "Graduation song for daughter" },
      { url: "/graduation-song", text: "Graduation song landing page" },
      { url: "/blog/graduation-gift-song", text: "Graduation gift song ideas" },
    ],
    utmCampaign: "graduation_for_son",
  },

  // ============================================================
  // AI-GENERATOR-VERTICAL BRIDGE PAGES
  // Capture broad AI-generator search traffic; position content as
  // gift-occasion. The keyword is the surfboard, the gift is the brand.
  // ============================================================
  {
    slug: "ai-song-generator-for-gifts",
    metaTitle: "AI Song Generator for Gifts | Porizo",
    metaDescription:
      "Use an AI song generator to make a personalized song gift — original lyrics from a real memory, sung in your own voice. Built for birthdays, anniversaries, and any occasion.",
    eyebrow: "AI song generator — built for gifts",
    h1: "The AI song generator built for song gifts.",
    lede:
      "Plenty of AI song generators make a song. Porizo makes a <em>gift</em>. The difference: Porizo turns one real memory into a 45-90 second song that fits the occasion, names the recipient, and ships as a shareable link sung in your own voice. Built specifically for birthdays, anniversaries, Mother's Day, Father's Day, weddings, graduations, and the in-between moments that earn their own song.",
    cardTag: "AI song generator for gifts",
    cardTitle: "Made For This Moment",
    cardLyric:
      `"This song does not exist anywhere else / it was written for you / three minutes ago / by someone who could not say it any other way."`,
    whyEyebrow: "Why a gift-built AI song generator",
    whyHeadline: "AI song generators make songs. Porizo makes a moment land.",
    whyBody:
      "General-purpose AI song generators (Suno, Donna, Muzio) are designed to make music — any kind of music, for any reason. Porizo is the AI song generator built for one specific job: <strong>turning a real moment between two people into a song gift</strong>. That changes everything downstream — the lyric structure is built around a recipient name and a memory, the song length is 45-90 seconds (right for a gift, not for a playlist), the audio ships as a shareable link the recipient can open in any browser, and the gifter's own voice sings the song via voice cloning. Among the established personalized-song marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none combine AI generation with voice cloning of the gifter. Porizo is positioned at that intersection on purpose.",
    bestForEyebrow: "Use it for",
    bestForHeadline: "Occasions an AI song generator should be built for.",
    bestForMoments: [
      "<strong>Birthdays.</strong> Milestone birthdays, surprise birthdays, kids' birthdays, the one your grandma never asks for.",
      "<strong>Anniversaries.</strong> 1st, 5th, 10th, 25th, 50th — and the random Tuesday that became its own anniversary.",
      "<strong>Mother's Day and Father's Day.</strong> The two days a card never quite carries.",
      "<strong>Weddings.</strong> A speech-replacement, a first-dance, a song from the parents to the couple.",
      "<strong>Graduations, retirements, new babies.</strong> Chapters that earn their own soundtrack.",
      "<strong>Just-because moments.</strong> An apology, a thank-you, a long-distance check-in, a song for a friend going through it.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one memory to a finished song-gift in three minutes.",
    exampleStarRow: "For a friend's 30th birthday",
    exampleLyric:
      `"You still laugh the loudest at the joke that never lands / you still light every room with the same impossible energy you had at twenty-two / another year brighter, another year you."`,
    exampleStyle: "Pop ballad · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "she always laughs at her own jokes before they land." Porizo expanded that into a verse and a chorus, then sang it back in the gifter\'s tone — the kind of song-gift no general-purpose AI generator is built to ship.',
    faqEyebrow: "FAQ",
    faqHeadline: "AI song generator questions.",
    faqs: [
      {
        q: "How is Porizo different from Suno, Donna, or other AI song generators?",
        a: "Suno, Donna, and Muzio are built for general music creation — any genre, any reason, often instrumental. Porizo is built for <em>song gifts</em>: short (45-90 sec), structured around a recipient name and memory, sung in the gifter's own voice via voice cloning, shareable as a link. Different jobs.",
      },
      {
        q: "Can the song really be sung in my own voice?",
        a: "Yes. Porizo includes voice cloning on Plus and Pro plans. Record 6-10 short phrases once inside the app and every future song is sung in your voice. None of the established human-composer gift services (Songfinch, Songlorious) offer this; few general-purpose AI generators apply it to song-gift use cases.",
      },
      {
        q: "Is this a free AI song generator?",
        a: "The first song is free on the Free plan. Voice cloning, unlimited songs per month, and Pro features are on the Plus ($9.99/mo) and Pro ($14.99/mo) plans. Annual billing reduces effective per-song cost to $1.50-$2.50.",
      },
      {
        q: "How long does it take to make a song?",
        a: "Preview: under 90 seconds. Full 45-90 second song: about three minutes. Human-composer services typically take 4-7 days (Songfinch) or 24 hours to 30 days (Songheart) at $69.99-$299 per song.",
      },
      {
        q: "Can I make a Father's Day or Mother's Day song with this?",
        a: "Yes — those are core use cases. Porizo has dedicated flows for Father's Day, Mother's Day, birthdays, anniversaries, weddings, graduations, retirements, and custom occasions. See <a href=\"/gifts/fathers-day-song-for-dad\">Father's Day song for dad</a>, <a href=\"/mothers-day-song\">Mother's Day song</a>, or <a href=\"/custom-song-gift\">custom song gift</a> for examples.",
      },
      {
        q: "Does the recipient need to install the app?",
        a: "No. The song generates a shareable web link that plays instantly in any browser. Optional device binding restricts who can claim and store the song.",
      },
    ],
    internalLinks: [
      { url: "/gifts/fathers-day-song-for-dad", text: "Father's Day song for dad" },
      { url: "/gifts/anniversary-song-for-wife", text: "Anniversary song for wife" },
      { url: "/custom-song-gift", text: "Custom song gift" },
    ],
    utmCampaign: "ai_song_generator_for_gifts",
  },

  {
    slug: "ai-song-maker-for-birthday",
    metaTitle: "AI Song Maker for Birthday Gifts | Porizo",
    metaDescription:
      "AI song maker for personalized birthday gifts — original lyrics from a real birthday memory, sung in your own voice. Finished in about three minutes.",
    eyebrow: "AI song maker — for birthday gifts",
    h1: "An AI song maker built for birthday gifts.",
    lede:
      "Most AI song makers ask 'what kind of music do you want?' Porizo asks 'whose birthday is it, and what's one thing only you would know?' The answer becomes the song — original lyrics, original music, sung in your own voice. Finished in about three minutes.",
    cardTag: "AI song maker for birthdays",
    cardTitle: "Another Year Brighter",
    cardLyric:
      `"You still laugh the loudest at jokes that never land / you still light every room with the same impossible energy you had at twenty-two."`,
    whyEyebrow: "Why a gift-built AI song maker",
    whyHeadline: "Generic AI song makers play. A birthday-built one lands.",
    whyBody:
      "A general-purpose AI song maker can produce a song about anyone, any genre, any vibe. The result is technically impressive and emotionally generic. Porizo flips that: every input is built around a <em>specific birthday</em> — the recipient's name, the relationship, a real memory, the occasion. The song that comes out is 45-90 seconds long, sung in your own voice via voice cloning, and lands in a shareable link the birthday person opens once. Among established personalized-song marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none combine AI generation with voice cloning of the gifter. Porizo is the AI song maker built for that specific job.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Birthdays an AI song maker should be built for.",
    bestForMoments: [
      "<strong>Milestone birthdays.</strong> 18, 21, 30, 40, 50, 60, 70 — the years where a card doesn't carry it.",
      "<strong>Last-minute birthdays.</strong> Finished song in about three minutes. Shareable as a link the same hour.",
      "<strong>Long-distance birthdays.</strong> A friend who moved, a parent overseas, a partner deployed. The link crosses the distance instantly.",
      "<strong>Surprise birthday songs.</strong> Play it at the dinner. Hand someone the phone before they cut the cake.",
      "<strong>Kids' birthdays.</strong> A song with their name, nickname, and the things they love. Lasts longer than any toy.",
      "<strong>Birthdays for someone hard to shop for.</strong> The dad with everything. The friend who 'doesn't want a thing.' The grandparent who has lived through enough versions of every gift.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one inside joke to a finished birthday song.",
    exampleStarRow: "For a friend's 30th birthday",
    exampleLyric:
      `"You still laugh the loudest at the joke that never lands / you still light every room with the same impossible energy you had at twenty-two / another year brighter, another year you."`,
    exampleStyle: "Pop ballad · 75 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: she always laughs at her own jokes before they land. Porizo expanded that into a full song — the kind a birthday earns.",
    faqEyebrow: "FAQ",
    faqHeadline: "AI birthday song maker questions.",
    faqs: [
      {
        q: "How is this different from Suno or other AI song generators?",
        a: "Suno is built for general music creation. Porizo is built for birthday song gifts: short, structured around the birthday person, sung in your own voice via voice cloning, shareable as a link. Different jobs, different tools.",
      },
      {
        q: "Can I really make the song sound like me singing for someone's birthday?",
        a: "Yes. Voice cloning is included on Plus and Pro. Record 6-10 short phrases once and every birthday song is sung in your voice. Hearing your voice is the part that makes a birthday song land harder than any card.",
      },
      {
        q: "What if the birthday is today?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can have a finished birthday song before the candles are lit.",
      },
      {
        q: "What kind of memory should I give Porizo?",
        a: "One specific detail. An inside joke, a phrase only you two say, a moment you both remember, something they do that nobody else does. The lyric grows from that single detail. See <a href=\"/blog/how-to-give-personalized-song-gift\">how to give a personalized song gift</a> for examples.",
      },
      {
        q: "Can I make different songs for different relationships?",
        a: "Yes — for dad's birthday, mom's birthday, a kid's birthday, a friend's milestone. Each builds from the relationship and memory you describe. See <a href=\"/gifts/birthday-song-for-grandma\">birthday song for grandma</a> or <a href=\"/gifts/birthday-song-for-grandpa\">birthday song for grandpa</a> for examples.",
      },
      {
        q: "How is this priced vs Songfinch or other birthday song services?",
        a: "Songfinch is $179.99-$199.99 per song, 4-7 day delivery. Porizo is $9.99/month for 4 songs (Plus) or $14.99/month for 10 songs (Pro) — and ships in minutes with voice cloning, which Songfinch doesn't offer.",
      },
    ],
    internalLinks: [
      { url: "/birthday-song-maker", text: "Birthday song maker" },
      { url: "/gifts/birthday-song-for-grandma", text: "Birthday song for grandma" },
      { url: "/gifts/birthday-song-for-grandpa", text: "Birthday song for grandpa" },
    ],
    utmCampaign: "ai_song_maker_birthday",
  },

  {
    slug: "ai-song-for-mom",
    metaTitle: "AI Song for Mom (Mother's Day & Birthday Gifts) | Porizo",
    metaDescription:
      "Make an AI song for Mom — personalized lyrics from a real memory, sung in your own voice. Built for Mother's Day, her birthday, anniversaries, or any moment.",
    eyebrow: "AI song for mom — gift edition",
    h1: "Make Mom an AI song that's actually about her.",
    lede:
      "AI songs are easy to generate. AI songs <em>about your specific mom</em> are different. Porizo turns one real memory — her phone voice, her one good chair, the way she shows up at the airport — into a 45-90 second song, sung in your own voice. Mother's Day, her birthday, the anniversary of something quietly important.",
    cardTag: "AI song for Mom",
    cardTitle: "The Door Was Always Open",
    cardLyric:
      `"You answered the door before I knocked / you knew the year I came home for the first time meaning to stay."`,
    whyEyebrow: "Why a gift-built AI song for Mom",
    whyHeadline: "AI songs flatter the algorithm. A song-gift for Mom hits her.",
    whyBody:
      "Most AI song generators are general purpose — pick a vibe, pick a genre, get a song. A song <em>for Mom</em> needs more specificity: her name in the lyric, the memory only you remember, the version of her that only you saw. Porizo builds the lyric around those details and then sings it back in your own voice via voice cloning, which means when she plays it she hears <em>you</em>. That recognition is the gift. Among the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter. Porizo is the AI song app built around the gift moment with the gifter's voice at the center.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Moments an AI song for Mom should be built for.",
    bestForMoments: [
      "<strong>Mother's Day.</strong> The card-replacement that actually outlives the brunch.",
      "<strong>Mom's birthday.</strong> Milestone or not — a song specific to her, not the category.",
      "<strong>The first Mother's Day after a hard year.</strong> Health, loss, distance, transition. The song that says what the year made you realize.",
      "<strong>A new-mom's first Mother's Day.</strong> A song from spouse or family naming what she just became.",
      "<strong>A long-distance song for Mom.</strong> Different country, different time zone, different decade. The link crosses everything.",
      "<strong>A surprise just-because song.</strong> No occasion, no warning, no card. Just a song that arrives on a Tuesday.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one phone-call detail to a song for Mom.",
    exampleStarRow: "For Mom's 60th birthday",
    exampleLyric:
      `"You answered every call like the phone surprised you / you kept my photos on the fridge for twenty years / you taught me what stays — and what stays doesn't leave when you ask it to."`,
    exampleStyle: "Folk ballad · 70 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: Mom always answers the phone surprised, like she can't believe you called. Porizo built the song around that ritual.",
    faqEyebrow: "FAQ",
    faqHeadline: "AI song for Mom questions.",
    faqs: [
      {
        q: "What's the difference between this and a Suno song for Mom?",
        a: "Suno makes general music. Porizo makes a song-gift built around your specific mom: 45-90 sec, structured around her name and a memory, sung in your own voice via voice cloning, shareable as a link. Different categories of output.",
      },
      {
        q: "Can the song be in my own voice?",
        a: "Yes — voice cloning is included on Plus and Pro. Record 6-10 short phrases once and every song after that is in your voice. For a song to Mom, your voice is what makes it land.",
      },
      {
        q: "Will Mom know how to play the song?",
        a: "If she's used FaceTime once, she can play this. The song is a web link — open it on your phone or send it by text. Plays in any browser, no app, no install.",
      },
      {
        q: "Can multiple siblings contribute to the same song for Mom?",
        a: "Yes. Either one sibling enrolls their voice and writes the song while mentioning everyone in the lyric, or each sibling makes a separate song with their own voice. Many families do both.",
      },
      {
        q: "Is there a free AI song for Mom option?",
        a: "Free plan includes one song. Voice cloning starts on Plus ($9.99/mo, 4 songs/mo). Annual billing brings effective per-song cost to ~$2.50.",
      },
      {
        q: "How does this compare to Songfinch for a Mother's Day gift?",
        a: "Songfinch is $179.99+ and ships in 4-7 days. Porizo is $9.99/mo and ships in minutes, with your own voice singing. Different tools for different timelines.",
      },
    ],
    internalLinks: [
      { url: "/mothers-day-song", text: "Mother's Day song" },
      { url: "/birthday-song-for-mom", text: "Birthday song for mom" },
      { url: "/gifts/anniversary-song-for-wife", text: "Anniversary song for wife" },
    ],
    utmCampaign: "ai_song_for_mom",
  },

  {
    slug: "ai-song-for-dad",
    metaTitle: "AI Song for Dad (Father's Day & Birthday Gifts) | Porizo",
    metaDescription:
      "Make an AI song for Dad — personalized lyrics from a real memory, sung in your own voice. Built for Father's Day, his birthday, milestones, or any moment.",
    eyebrow: "AI song for dad — gift edition",
    h1: "Make Dad an AI song that's actually about him.",
    lede:
      "An AI can write any song. The challenge is writing the song for the specific dad who taught you to drive on Sundays, who hums the same hymn every Christmas, who answers his phone with a sigh and a smile. Porizo turns one real memory into a 45-90 second song for Dad — sung in your own voice. Finished in about three minutes.",
    cardTag: "AI song for Dad",
    cardTitle: "The Long Sundays of Dad",
    cardLyric:
      `"You taught me to drive on a Sunday road / told me the brake was kinder than the wheel / and forty years later I still hear it / when the world gets noisy I remember the line."`,
    whyEyebrow: "Why a gift-built AI song for Dad",
    whyHeadline: "An AI song for Dad has to be about <em>him</em>, not about AI.",
    whyBody:
      "Plenty of AI song apps will write you a song about a dad. Porizo writes one about <em>your</em> dad — the workshop he refuses to retire, the recipe he protects, the line he repeats every December. The lyric is built from those details and sung in your own voice via voice cloning, which means when he plays it on the drive home from work he hears <em>you</em>. That recognition does work no generic AI song can do. Among the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter; Porizo is the AI song app built specifically for that gift moment.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Moments an AI song for Dad should be built for.",
    bestForMoments: [
      "<strong>Father's Day.</strong> The day a tie or a card can't quite carry.",
      "<strong>Dad's birthday.</strong> Milestone or not. A song specific to him, not the category.",
      "<strong>A milestone year — 50, 60, 70.</strong> A song that names the decades.",
      "<strong>The first Father's Day after a hard year.</strong> The year you don't take for granted.",
      "<strong>The dad who has everything.</strong> The man who refuses gifts but plays the same five songs on repeat. Add yours to the list.",
      "<strong>A long-distance song for Dad.</strong> Different city, different country, different relationship after the moves. The link crosses everything.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one Saturday memory to a song for Dad.",
    exampleStarRow: "For Dad's 65th birthday",
    exampleLyric:
      `"You taught me how to drive on a Sunday road / told me the brake was kinder than the wheel / and every time I borrow your jacket / I find another year you carried me through."`,
    exampleStyle: "Acoustic folk · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "Dad insisted I learn to drive on Sundays — empty roads, no traffic." Porizo turned that sentence into a verse, a chorus, and a bridge, sung in the gifter\'s tone.',
    faqEyebrow: "FAQ",
    faqHeadline: "AI song for Dad questions.",
    faqs: [
      {
        q: "What's different about Porizo vs Suno or another AI song generator for Dad?",
        a: "Suno makes general music. Porizo makes a song-gift: short (45-90 sec), structured around your specific dad and a memory, sung in your own voice via voice cloning, shareable as a link he opens on his phone. Different jobs.",
      },
      {
        q: "Can the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6-10 short phrases once and every song after is in your voice. For a song from a son or daughter to Dad, your voice is what makes it stick.",
      },
      {
        q: "Will Dad know how to play it?",
        a: "If he's opened a YouTube link this year, he'll be fine. The song plays in the browser, no app, no install, no account.",
      },
      {
        q: "What if Dad isn't really a music guy?",
        a: "Most non-music dads keep these songs anyway. The reason is the specificity. It's not about music — it's about him.",
      },
      {
        q: "Can multiple kids contribute to the same song for Dad?",
        a: "Yes. Either one kid enrolls their voice and the lyric mentions every kid, or each kid makes a separate song. Families often do both for milestone years.",
      },
      {
        q: "How does this compare to Songfinch for a Father's Day gift?",
        a: "Songfinch is $179.99+ and ships in 4-7 days. Porizo is $9.99/month and ships in minutes, with your own voice. For Father's Day timing pressure, the speed matters; for the gift to actually land, the voice matters.",
      },
    ],
    internalLinks: [
      { url: "/gifts/fathers-day-song-for-dad", text: "Father's Day song for dad" },
      { url: "/birthday-song-for-dad", text: "Birthday song for dad" },
      { url: "/gifts/fathers-day-song-for-grandpa", text: "Father's Day song for grandpa" },
    ],
    utmCampaign: "ai_song_for_dad",
  },

  {
    slug: "personalized-ai-song-generator",
    metaTitle: "Personalized AI Song Generator (Gift Edition) | Porizo",
    metaDescription:
      "Personalized AI song generator built for gifts — original lyrics from a real memory, sung in your own voice. Birthdays, anniversaries, any occasion.",
    eyebrow: "Personalized AI song generator",
    h1: "A personalized AI song generator built for the gift moment.",
    lede:
      "There are AI song generators. There are personalized song services. Porizo is the one personalized AI song generator built specifically for the <em>gift moment</em> — short (45-90 sec), structured around a recipient name and one real memory, sung in your own voice via voice cloning, shareable as a link before the recipient installs anything.",
    cardTag: "Personalized AI for gifts",
    cardTitle: "Built For This One Gift",
    cardLyric:
      `"This song does not exist anywhere else / it was written for one person / sung by one person / and finished while the coffee was still warm."`,
    whyEyebrow: "Why personalized AI for gifts specifically",
    whyHeadline: "Generic AI makes generic songs. The gift moment needs a specific tool.",
    whyBody:
      "Most personalized song services use human composers and ship in days for $69-$299 (Songfinch, Songlorious, Songheart, ForeverSong). Most AI song generators are built for general music creation (Suno, Donna, Muzio). Porizo lives at the intersection neither of those occupies: a personalized AI song generator built explicitly for the gift moment. The recipient name goes in the lyric. The memory shapes the verse. The gifter's own voice sings the chorus via voice cloning. The output ships in three minutes as a shareable web link. Among the established personalized-song marketplaces, voice cloning of the gifter is not offered by any. Porizo is positioned at that intersection on purpose.",
    bestForEyebrow: "Built for",
    bestForHeadline: "Where a personalized AI song generator earns its category.",
    bestForMoments: [
      "<strong>Birthdays.</strong> Milestone, last-minute, surprise, kid, long-distance — all the variants.",
      "<strong>Anniversaries.</strong> First, fifth, tenth, twenty-fifth, fiftieth — and the ones nobody plans for.",
      "<strong>Mother's Day and Father's Day.</strong> The two days a card and a brunch don't quite carry.",
      "<strong>Weddings and engagements.</strong> A first-dance song, a parent-to-couple song, a proposal song.",
      "<strong>Graduations, retirements, new babies.</strong> The chapters that earn their own song.",
      "<strong>Apologies, thank-yous, hard-time messages.</strong> The moments a card was never going to be enough.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one specific memory to a finished song-gift.",
    exampleStarRow: "For a 25th anniversary",
    exampleLyric:
      `"Twenty-five Septembers / and you still hum the same way over coffee / you still answer my one bad joke / and somehow the same morning gets new each time."`,
    exampleStyle: "Acoustic · 75 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "She hums when she pours coffee, the same way she did our first morning together." Porizo built a verse and chorus around that and stacked twenty-five years onto it.',
    faqEyebrow: "FAQ",
    faqHeadline: "Personalized AI song generator questions.",
    faqs: [
      {
        q: "How is Porizo different from other personalized song services like Songfinch?",
        a: "Songfinch and similar (Songlorious, Songheart, ForeverSong) use human composers and ship in days for $69-$299 per song. Porizo uses AI generation and ships in minutes for $9.99/month, with voice cloning of the gifter — which none of the human-composer services offer.",
      },
      {
        q: "How is Porizo different from a general AI song generator like Suno?",
        a: "Suno is built for general music creation across any genre and any topic. Porizo is built specifically for the personalized song-gift moment: short, structured around a recipient and memory, sung in the gifter's voice, shareable as a link.",
      },
      {
        q: "How long does the song take?",
        a: "Preview in under 90 seconds. Full 45-90 second song in about three minutes.",
      },
      {
        q: "Can I really sound like me singing?",
        a: "Yes. Voice cloning is included on Plus and Pro. Record 6-10 short phrases once inside the app and every future song is sung in your voice.",
      },
      {
        q: "What occasions are supported?",
        a: "Birthdays (any age, any relationship), anniversaries, Mother's Day, Father's Day, weddings, graduations, retirements, apologies, thank-yous, and just-because moments. See <a href=\"/gifts/fathers-day-song-for-dad\">Father's Day for dad</a>, <a href=\"/gifts/anniversary-song-for-wife\">anniversary for wife</a>, or <a href=\"/custom-song-gift\">custom song gift</a>.",
      },
      {
        q: "Does the recipient need the app to hear it?",
        a: "No. The song generates a shareable web link that plays instantly in any browser.",
      },
    ],
    internalLinks: [
      { url: "/gifts/ai-song-generator-for-gifts", text: "AI song generator for gifts" },
      { url: "/custom-song-gift", text: "Custom song gift" },
      { url: "/songfinch-alternative", text: "vs Songfinch" },
    ],
    utmCampaign: "personalized_ai_song_generator",
  },

  {
    slug: "graduation-song-for-daughter",
    metaTitle: "Graduation Song for Daughter | Porizo",
    metaDescription:
      "Personalized graduation song for your daughter — original lyrics about who she is right now, sung in your voice. Finished in minutes.",
    eyebrow: "Graduation song for daughter",
    h1: "Graduation song for your daughter.",
    lede:
      "She'll keep the card for a year. She'll keep a song forever. A Porizo graduation song captures one specific thing about who your daughter became across the years that led to today — the focus, the resilience, the way she says her own name — and turns it into a song, sung in your voice.",
    cardTag: "Graduation — for her",
    cardTitle: "The Long Quiet Yes",
    cardLyric:
      '"You didn\'t ask for the room — you built the room / you didn\'t wait for the door — you remembered every key."',
    whyEyebrow: "Why Porizo for graduation",
    whyHeadline: "A graduation gift that doesn't end with the ceremony.",
    whyBody:
      "Graduation gifts for daughters default to jewelry, framed diplomas, or a check tucked into a card. They sit in a drawer. A Porizo song doesn't — because it's specific to her. The thing she said when she didn't get into her first choice. The book she finished at 2am. The way she encouraged her younger sibling through a hard semester. Those become the lyric, sung in your own voice via voice cloning. None of the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) offer voice cloning of the gifter. She plays the song on the way to the ceremony, the morning of her first job, the night before her first big presentation. It outlives the dinner.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Graduation moments that earn their own song.",
    bestForMoments: [
      "<strong>High-school graduation.</strong> The first big chapter. A song that names the years that built her.",
      "<strong>College graduation.</strong> The years that asked something of her. A song that says you saw it.",
      "<strong>Graduate-school or professional completion.</strong> Master's, JD, MD, MBA, PhD. The longer years. The deserving song.",
      "<strong>A return-to-school graduation.</strong> If she went back at 30, 40, 50. The courage and time deserve naming.",
      "<strong>A first-generation graduation.</strong> First in the family. A song that names what that means without making it heavier than it should be.",
      "<strong>A surprise after the ceremony.</strong> Play it on the drive home. Watch her face.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one specific year to a full graduation song.",
    exampleStarRow: "For a daughter's college graduation",
    exampleLyric:
      '"You did the second draft when nobody asked / you sat with the question one more night / and the answer didn\'t come — but you came back the next morning anyway."',
    exampleStyle: "Indie folk · 80 seconds · sung in the gifter's voice",
    exampleNote:
      'The lyric came from one detail: "She rewrote her thesis chapter three times in one week." Porizo built the song around discipline and showing up again.',
    faqEyebrow: "FAQ",
    faqHeadline: "Graduation song questions.",
    faqs: [
      {
        q: "Will my daughter actually like this?",
        a: "Most graduates 'don't really listen to that kind of music' and play these anyway. The reason is the specificity. It's not about music — it's about her.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and Porizo sings every song in your voice. For a graduation song from a parent to a daughter, your voice is what makes it stick.",
      },
      {
        q: "Can I include her school name or major?",
        a: "Yes. Include them in the memory or message you describe. The lyric will weave them in.",
      },
      {
        q: "What if both parents want to contribute to the song?",
        a: "Either enroll one voice and reference both parents in the lyric, or enroll both voices separately and make two short songs — a verse from each.",
      },
      {
        q: "Can I include her sister/brother in the lyric?",
        a: "Yes. Siblings, grandparents, partners — mention them in the memory. The lyric will name them naturally.",
      },
      {
        q: "How does this compare to Songfinch?",
        a: "Songfinch uses human composers and ships in 4–7 days for $179.99+. Porizo ships in minutes for $9.99/month and adds voice cloning — your own voice singing — which Songfinch cannot do.",
      },
    ],
    internalLinks: [
      { url: "/gifts/graduation-song-for-son", text: "Graduation song for son" },
      { url: "/graduation-song", text: "Graduation song landing page" },
      { url: "/blog/graduation-gift-song", text: "Graduation gift song ideas" },
    ],
    utmCampaign: "graduation_for_daughter",
  },

  // ============================================================
  // RELATIONSHIP-SPECIFIC PAGES — capture queries App Store can't
  // reach without metadata words we don't have (boyfriend, girlfriend,
  // friend, long-distance, etc.). Google long-tail capture.
  // ============================================================

  {
    slug: "love-song-for-boyfriend",
    metaTitle: "Love Song for Boyfriend | Porizo",
    metaDescription:
      "Make a personalized love song for your boyfriend — original lyrics from a real shared moment, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Love song for boyfriend",
    h1: "Make him a love song he'll save.",
    lede:
      "A love song for your boyfriend doesn't need to be loud. It needs to be specific — the way he says your name when he's tired, the joke from your first month together, the morning he made you laugh in the kitchen. Porizo turns that one detail into a song, sung in your voice. Finished in about three minutes.",
    cardTag: "Love song for him",
    cardTitle: "The Quiet One",
    cardLyric:
      `"You said my name like a quiet question / and I have spent every morning since / trying to be the answer."`,
    whyEyebrow: "Why Porizo for a love song",
    whyHeadline: "A love song for boyfriends, built around the one thing only you would write.",
    whyBody:
      "Most love songs sound like other love songs. The pop hits, the playlist staples, the lines everyone has heard. A Porizo song is the opposite — it's built around a memory only you two would recognize. The joke from a third date, the way he holds your hand when he is nervous, the song he plays when he drives. Sung in your own voice via voice cloning, which means when he plays it on his phone he hears <em>you</em> singing him lyrics nobody else has ever written. Among the established personalized-song gift services (Songfinch, Songlorious, Songheart, ForeverSong) none combine AI generation with voice cloning of the gifter. Porizo is built for this exact moment.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Love-song moments boyfriends actually keep.",
    bestForMoments: [
      "<strong>Your anniversary.</strong> A song specific to the year — not a generic love anthem.",
      "<strong>Valentine's Day.</strong> The card-replacement that outlives February.",
      "<strong>His birthday.</strong> A love song doubling as a birthday gift; he plays it twice.",
      "<strong>The first holiday apart.</strong> Travel, family, work. The song crosses the distance instantly.",
      "<strong>A just-because Tuesday.</strong> No occasion, no warning. A song that arrives on a random day.",
      "<strong>The 'we don't really do gifts' phase.</strong> Two minutes of effort, sized exactly to a no-pressure relationship.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one inside joke to a finished love song.",
    exampleStarRow: "For a boyfriend — year three",
    exampleLyric:
      `"You text 'on my way' from two blocks out / you laugh at the joke before I land it / and three years in I still don't know how / something this small became this whole."`,
    exampleStyle: "Acoustic · 75 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: he texts 'on my way' from two blocks away. Porizo built a verse around the ritual and a chorus about how three years made small things bigger.",
    faqEyebrow: "FAQ",
    faqHeadline: "Love-song-for-boyfriend questions.",
    faqs: [
      {
        q: "What if we've only been together a few months?",
        a: "Porizo works for any stage. Give it one specific moment from those months — a first impression that stuck, an early inside joke. The lyric grows from that detail. Short relationships are some of the best song subjects because the details are fresh.",
      },
      {
        q: "Can he hear it sounding like me singing?",
        a: "Yes — voice cloning is included on Plus and Pro. Record 6–10 short phrases once inside the app and every song is sung in your own voice. For a love song to a partner, your voice is half the gift.",
      },
      {
        q: "What if he's not really 'into' love songs?",
        a: "Most boyfriends who 'don't really listen to that stuff' play these anyway. The reason is the specificity. It's not a love song — it's a song about him.",
      },
      {
        q: "Can I make it funny or playful instead of romantic?",
        a: "Yes. Porizo lets you pick the genre and tone — country, pop, R&B, indie folk, even something more upbeat. The lyric tone follows your direction.",
      },
      {
        q: "Should I share it on social or send it privately?",
        a: "Most people send it privately first. He gets to hear it alone, react alone, and decide if he wants to share. Some couples post it later as their anniversary post — that part is his call.",
      },
      {
        q: "How is this different from a Spotify playlist for him?",
        a: "A playlist says 'I curated these.' A Porizo song says 'this exists nowhere else — it was written for you, sung by me, three minutes ago.' Different category of gift entirely.",
      },
    ],
    internalLinks: [
      { url: "/gifts/love-song-for-girlfriend", text: "Love song for girlfriend" },
      { url: "/gifts/long-distance-song-gift", text: "Long-distance song gift" },
      { url: "/custom-song-gift", text: "Custom song gift" },
    ],
    utmCampaign: "love_song_boyfriend",
  },

  {
    slug: "love-song-for-girlfriend",
    metaTitle: "Love Song for Girlfriend | Porizo",
    metaDescription:
      "Make a personalized love song for your girlfriend — original lyrics from a real shared moment, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Love song for girlfriend",
    h1: "Make her a love song that's actually about her.",
    lede:
      "Most love songs are about a feeling. A Porizo love song is about a person — the way she laughs at her own jokes before they land, the song she always sings off-key in the car, the way she says 'one more episode' at 2am. Sung in your own voice. Finished in about three minutes.",
    cardTag: "Love song for her",
    cardTitle: "One More Episode",
    cardLyric:
      `"You said 'one more episode' three episodes ago / and I have been writing love songs about you in my head / longer than the show has been on."`,
    whyEyebrow: "Why Porizo for a love song",
    whyHeadline: "A love song for girlfriends, built around the one detail only you noticed.",
    whyBody:
      "Pop love songs are written for everyone, which means they're written for no one in particular. A Porizo love song is written for one person — about her name, the way she laughs at her own jokes, the morning she said the thing you still think about. Sung in your own voice via voice cloning, which means she doesn't hear a singer. She hears <em>you</em>. None of the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) offer this. Porizo is the personalized-song app built for the exact gift moment when a card isn't enough and a playlist isn't yours.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Love-song moments girlfriends actually keep.",
    bestForMoments: [
      "<strong>Your anniversary.</strong> A song specific to the year — not the relationship in general.",
      "<strong>Valentine's Day.</strong> The card-replacement she'll play in April.",
      "<strong>Her birthday.</strong> A love song doubling as a birthday gift; she plays it on her drive home.",
      "<strong>The first holiday apart.</strong> Family, travel, exams. The song crosses the distance instantly.",
      "<strong>The morning after a fight.</strong> Not an apology song — a love song that says 'I still saw you yesterday'.",
      "<strong>A just-because Tuesday.</strong> No card, no excuse, no occasion. Just a song that arrives.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one specific morning to a finished love song.",
    exampleStarRow: "For a girlfriend — year two",
    exampleLyric:
      `"You laugh at the joke before I land it / you hum a different song every time you make coffee / and two years of small Tuesdays / has somehow turned into the love song I was trying to write all along."`,
    exampleStyle: "Indie folk · 80 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: she hums a different song every morning while making coffee, never the same one twice. Porizo built a verse around the ritual and a chorus about ordinary days becoming the love story.",
    faqEyebrow: "FAQ",
    faqHeadline: "Love-song-for-girlfriend questions.",
    faqs: [
      {
        q: "What if we just started dating?",
        a: "Porizo works for any stage of relationship. New relationships often produce the strongest songs because the details are fresh. Give it one specific moment from your first weeks — a first impression, a first laugh — and the lyric grows from there.",
      },
      {
        q: "Can she hear it sounding like me singing?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once inside the app and every song is sung in your own voice. For a love song from boyfriend to girlfriend, your voice is the part she'll replay.",
      },
      {
        q: "What if I'm bad at writing love songs?",
        a: "You don't write it. You give Porizo one specific memory or detail about her — the way she does a particular thing — and Porizo builds the verse and chorus around that. You provide the moment; the lyric grows from it.",
      },
      {
        q: "How is this different from a custom song from Songfinch or Songlorious?",
        a: "Songfinch and Songlorious use human composers and ship in 4–7 days for $179.99–$199.99. Porizo ships in minutes for $9.99/month and sings the song in your own voice, which neither offers.",
      },
      {
        q: "Can I make multiple songs over time?",
        a: "Yes. Plus is 4 songs/month and Pro is 10 songs/month — many couples make a new song for each anniversary, each Valentine's Day, each surprise moment.",
      },
      {
        q: "Should I send it privately or play it for her?",
        a: "Send privately first. Let her hear it alone, react alone, decide if she wants to share. Playing it for her in person works best later, when she's already heard it once.",
      },
    ],
    internalLinks: [
      { url: "/gifts/love-song-for-boyfriend", text: "Love song for boyfriend" },
      { url: "/gifts/long-distance-song-gift", text: "Long-distance song gift" },
      { url: "/custom-song-gift", text: "Custom song gift" },
    ],
    utmCampaign: "love_song_girlfriend",
  },

  {
    slug: "long-distance-song-gift",
    metaTitle: "Long Distance Song Gift | Porizo",
    metaDescription:
      "A personalized song gift for long distance — original lyrics about the specific distance, sung in your own voice. The link crosses everything instantly.",
    eyebrow: "Long distance song gift",
    h1: "A long-distance song that crosses the distance instantly.",
    lede:
      "Cards take a week. Flowers wilt. Letters get lost. A Porizo long-distance song gift travels at the speed of a text message — original lyrics about the specific distance you two are managing, sung in your own voice, opened in any browser. Finished in about three minutes.",
    cardTag: "Long distance song",
    cardTitle: "Three Time Zones",
    cardLyric:
      `"Three time zones / and you still wake up earlier to text me / and I still stay up later to answer / and somehow the math of us still works."`,
    whyEyebrow: "Why Porizo for long distance",
    whyHeadline: "The gift built for the relationship that lives on a phone.",
    whyBody:
      "Long-distance relationships and friendships make gifts harder. You can't show up at the door. Shipping takes a week. Cards arrive late. A Porizo song gift solves the format problem — it ships in minutes as a web link that plays in any browser, no install, no account required to listen. And the lyric is built around the <em>specific</em> distance: the time zone, the missed dinners, the running joke about who calls first. Sung in your own voice via voice cloning, which means when they play the song at their desk they hear <em>you</em>, not a stranger. Among the established personalized-song marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none combine AI generation with voice cloning of the gifter.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Long-distance moments that earn their own song.",
    bestForMoments: [
      "<strong>A long-distance anniversary.</strong> Different cities, same date. A song that lands on both phones at once.",
      "<strong>A long-distance birthday.</strong> When you can't be there for the candles.",
      "<strong>Military deployment or international assignment.</strong> Months apart. A song that holds the distance.",
      "<strong>A long-distance Mother's Day or Father's Day.</strong> The parent in a different country who answers the phone surprised.",
      "<strong>A friend who moved away.</strong> The decade of friendship that became a series of texts. A song that names what stayed.",
      "<strong>Study abroad / a semester away.</strong> A song from family or partner that travels with them.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From three time zones to one shared song.",
    exampleStarRow: "For a partner overseas — year two of long distance",
    exampleLyric:
      `"Three time zones away you eat dinner when I eat breakfast / and we have learned the math of saying goodnight in the morning / and you have not let me forget once / what your laugh sounds like at 6am your time."`,
    exampleStyle: "Acoustic · 75 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: 'We FaceTime when she's eating dinner and I'm eating breakfast.' Porizo built a verse around the time-zone math and a chorus about the way distance changes the rituals.",
    faqEyebrow: "FAQ",
    faqHeadline: "Long-distance song gift questions.",
    faqs: [
      {
        q: "How do I get the song to them across the world?",
        a: "Send a web link by text, email, WhatsApp, or any messaging app. The song plays in any browser on any device. No app install required for the recipient.",
      },
      {
        q: "Will the song sound like me singing?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and every song is in your own voice. For a long-distance gift, hearing your voice is the part that lands hardest.",
      },
      {
        q: "What if my time zone is twelve hours ahead?",
        a: "Doesn't matter. The link works at any time. They can open it when they wake up and you can be asleep. The song waits.",
      },
      {
        q: "Can I include specific details about where we live?",
        a: "Yes. Mention the cities, the time difference, the way you do video calls, anything specific. The lyric weaves those details in.",
      },
      {
        q: "What if the recipient's internet is slow?",
        a: "The song is a short audio file (45–90 seconds). It loads fast even on a phone connection. The link also includes a low-bandwidth fallback.",
      },
      {
        q: "Can multiple people contribute to the same song for someone long-distance?",
        a: "Yes. Common pattern: one family member enrolls their voice and includes everyone's name in the lyric. Or each family member enrolls separately and makes their own version.",
      },
    ],
    internalLinks: [
      { url: "/gifts/love-song-for-boyfriend", text: "Love song for boyfriend" },
      { url: "/gifts/love-song-for-girlfriend", text: "Love song for girlfriend" },
      { url: "/blog/long-distance-song-gift", text: "Long-distance song gift ideas" },
    ],
    utmCampaign: "long_distance_song",
  },

  {
    slug: "apology-song-for-boyfriend",
    metaTitle: "Apology Song for Boyfriend | Porizo",
    metaDescription:
      "A personalized apology song for your boyfriend — original lyrics built around what actually happened, sung in your own voice. Honest, specific, finished in minutes.",
    eyebrow: "Apology song for boyfriend",
    h1: "Say sorry in a song he'll keep.",
    lede:
      "A text feels too small. A long apology feels like more about you than him. A Porizo apology song lands somewhere in between — short, specific to what happened, in your own voice. Original lyrics, finished in about three minutes.",
    cardTag: "Apology — for him",
    cardTitle: "The Honest Part",
    cardLyric:
      `"I was wrong about Thursday / I was wrong about the way I said it / and I am trying to be the kind of person / who can say that without making it about me."`,
    whyEyebrow: "Why a song apology works",
    whyHeadline: "An apology that does the work a text can't.",
    whyBody:
      "A text apology says 'sorry.' A long-form apology says 'sorry, but here is my side.' A Porizo apology song does something a text can't — it gives the apology shape and lets you say the harder thing without it sounding like a speech. The lyric is built around what specifically happened, what you would do differently, and the part you're owning. Sung in your own voice via voice cloning, which means he hears <em>you</em> saying it, not a singer. None of the established personalized-song gift services (Songfinch, Songlorious, Songheart, ForeverSong) offer voice cloning of the gifter — that's the part that makes an apology song land.",
    bestForEyebrow: "When this works",
    bestForHeadline: "Apology-song moments worth doing this for.",
    bestForMoments: [
      "<strong>An argument that ended badly the night before.</strong> The morning-after gesture.",
      "<strong>A pattern you're trying to break.</strong> Naming the thing out loud, in a song he can replay when he forgets you said it.",
      "<strong>Missed a moment that mattered.</strong> A birthday you forgot, an event you skipped, a call you didn't return.",
      "<strong>Long-distance fight.</strong> The argument that's been hanging over two cities for a week.",
      "<strong>An anniversary you didn't acknowledge.</strong> The repair before the next anniversary.",
      "<strong>The slow-burn 'I haven't been showing up for you'.</strong> The relationship audit that needed a quieter format.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one honest sentence to a finished song.",
    exampleStarRow: "After a Thursday fight",
    exampleLyric:
      `"I was wrong about Thursday / I was wrong about how I said it / and I have been thinking about your face for two days / which is the part I want you to know I noticed."`,
    exampleStyle: "Acoustic · 70 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one honest sentence: 'I was wrong about Thursday.' Porizo built a song around naming the specific moment instead of generalizing.",
    faqEyebrow: "FAQ",
    faqHeadline: "Apology song questions.",
    faqs: [
      {
        q: "Isn't an apology song kind of dramatic?",
        a: "Only if the song is dramatic. Porizo lets you pick the genre and tone — an acoustic, quiet, 60-second song often lands much better than a long text. The brevity is part of why it works.",
      },
      {
        q: "What if he thinks I'm trying to skip the real conversation?",
        a: "The song should not replace the real conversation. It works best as the prelude — something he can hear before the in-person talk, so he knows you've thought about it. Then have the conversation. The song earns you the conversation.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Hearing your own voice say the apology is what makes it land. A stranger singing your apology defeats the purpose.",
      },
      {
        q: "What should I include in the lyric?",
        a: "Three things: what specifically happened, what you would do differently, and the part you are owning. Avoid generalizations like 'sorry I've been off lately' — name the actual moment.",
      },
      {
        q: "How long should an apology song be?",
        a: "Short. 60–75 seconds. Long apology songs sound performative. Short ones sound real.",
      },
      {
        q: "What if he doesn't accept it?",
        a: "Then the song wasn't the problem; the situation needs more than music. A song apology is the right format only when both of you are already on the way back to each other.",
      },
    ],
    internalLinks: [
      { url: "/gifts/apology-song-for-girlfriend", text: "Apology song for girlfriend" },
      { url: "/blog/apology-song", text: "Apology song ideas" },
      { url: "/gifts/love-song-for-boyfriend", text: "Love song for boyfriend" },
    ],
    utmCampaign: "apology_song_boyfriend",
  },

  {
    slug: "apology-song-for-girlfriend",
    metaTitle: "Apology Song for Girlfriend | Porizo",
    metaDescription:
      "A personalized apology song for your girlfriend — original lyrics about what actually happened, sung in your own voice. Honest, specific, finished in minutes.",
    eyebrow: "Apology song for girlfriend",
    h1: "Say sorry in a song she'll listen to twice.",
    lede:
      "A long text reads defensive. Flowers feel like a deflection. A Porizo apology song does the harder work — naming the specific moment, owning the specific part, and arriving in your own voice. Finished in about three minutes.",
    cardTag: "Apology — for her",
    cardTitle: "The Sentence I Should Have Used",
    cardLyric:
      `"I should have used a different sentence / the one I rehearsed and then didn't say / and I want you to hear me say it now / so we can be done with the wrong one."`,
    whyEyebrow: "Why a song apology works",
    whyHeadline: "An apology built for women who can read between the lines.",
    whyBody:
      "A long apology text gets re-read and dissected. A flowers-only apology feels like an attempt to skip the conversation. A Porizo apology song is the format that does the real work: it names the specific moment, owns the specific part, and arrives in your own voice via voice cloning. She hears <em>you</em> say the harder sentence — the one you rehearsed and didn't quite get out. Among the established personalized-song marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter. Porizo is the AI song app built for the gift moment when nothing else fits.",
    bestForEyebrow: "When this works",
    bestForHeadline: "Apology moments worth doing this for.",
    bestForMoments: [
      "<strong>An argument that ended bad the night before.</strong> The morning-after gesture, before the next conversation.",
      "<strong>A pattern you're trying to break.</strong> A song that says it out loud so you can't pretend you didn't.",
      "<strong>Missed a moment that mattered.</strong> The birthday, the event, the call. The acknowledgment.",
      "<strong>Long-distance argument.</strong> The fight that's been hanging in different time zones for a week.",
      "<strong>The slow-burn 'I haven't been present'.</strong> The relationship audit that needed a different format.",
      "<strong>An anniversary you didn't honor.</strong> The repair before the next one.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one rehearsed sentence to a finished song.",
    exampleStarRow: "After a Sunday-night fight",
    exampleLyric:
      `"I should have used a different sentence on Sunday / the one I rehearsed in the shower / and then said the loud one instead / and I want you to hear me say the rehearsed one now."`,
    exampleStyle: "Acoustic · 70 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one honest beat: 'I rehearsed the right sentence and then said the wrong one anyway.' Porizo built the song around that exact dynamic.",
    faqEyebrow: "FAQ",
    faqHeadline: "Apology song questions.",
    faqs: [
      {
        q: "Is an apology song too much?",
        a: "Depends on the tone. A short, quiet, 60-second acoustic apology often does what a 300-word text cannot. The format does work that the medium of text can't.",
      },
      {
        q: "Should this replace the actual conversation?",
        a: "No. It's the prelude. Send the song before you call her or before you see her in person, so the conversation starts from a different place.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Hearing you say the apology is what makes the song work. A stranger's voice on an apology song defeats the purpose.",
      },
      {
        q: "What should the lyric say?",
        a: "Three things: what specifically happened, what you'd do differently, what part you're owning. Avoid words like 'just' or 'I guess.' Name the moment.",
      },
      {
        q: "How long should it be?",
        a: "60–75 seconds. Brief songs sound real. Long apology songs sound rehearsed.",
      },
      {
        q: "What if she doesn't reply?",
        a: "A song apology earns the conversation, not the resolution. If she doesn't reply, the song wasn't the wrong tool — the timing might have been. Wait and ask in person.",
      },
    ],
    internalLinks: [
      { url: "/gifts/apology-song-for-boyfriend", text: "Apology song for boyfriend" },
      { url: "/blog/apology-song", text: "Apology song ideas" },
      { url: "/gifts/love-song-for-girlfriend", text: "Love song for girlfriend" },
    ],
    utmCampaign: "apology_song_girlfriend",
  },

  {
    slug: "valentines-song-for-her",
    metaTitle: "Valentine's Day Song for Her | Porizo",
    metaDescription:
      "Make a personalized Valentine's song for her — original lyrics built around your specific story, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Valentine's song for her",
    h1: "A Valentine's song made for her, not the holiday.",
    lede:
      "Most Valentine's gifts are about the holiday. A Porizo Valentine's song is about <em>her</em> — the laugh, the joke from the first month, the way she says your name when she's running late. Original lyrics, sung in your own voice, finished in about three minutes.",
    cardTag: "Valentine's — for her",
    cardTitle: "Better Than February",
    cardLyric:
      `"You laugh like the year just opened a window / and February doesn't get the credit / I should have written this in March / and again in July."`,
    whyEyebrow: "Why Porizo for Valentine's",
    whyHeadline: "A Valentine's gift that doesn't smell like Valentine's.",
    whyBody:
      "Valentine's Day gifts default to roses, chocolates, jewelry — the same things everyone else is buying. A Porizo Valentine's song breaks out of that by being specific: about her name, the way she does a particular thing, the moment from your relationship that defines what Valentine's actually means for you two. Sung in your own voice via voice cloning, which means when she plays the song she hears <em>you</em>, not a stranger. None of the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) offer this. Porizo is the personalized-song app built for the gift moment when the holiday gift category isn't enough.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Valentine's moments that earn their own song.",
    bestForMoments: [
      "<strong>The first Valentine's together.</strong> A song that names the early-relationship details before they become old.",
      "<strong>The tenth Valentine's together.</strong> The card-stack year. The year a different gift earns a different reaction.",
      "<strong>A long-distance Valentine's.</strong> The song crosses the distance instantly.",
      "<strong>The 'we don't do Valentine's' Valentine's.</strong> A surprise that doesn't violate the rule because it's not a thing.",
      "<strong>A surprise after a hard year.</strong> The Valentine's where the song says you noticed everything.",
      "<strong>A second-chance Valentine's.</strong> The repair after a Valentine's that didn't land last year.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one detail to a finished Valentine's song.",
    exampleStarRow: "For a girlfriend — third Valentine's",
    exampleLyric:
      `"You laugh like the year just opened a window / you make Tuesday feel like a holiday / and February doesn't get to take credit / for what you do to every other month."`,
    exampleStyle: "Indie folk · 75 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: 'She laughs in a way that makes any random Tuesday feel like a small holiday.' Porizo built the song around that and pointed it back at Valentine's.",
    faqEyebrow: "FAQ",
    faqHeadline: "Valentine's song questions.",
    faqs: [
      {
        q: "How is this different from a Valentine's card?",
        a: "A card delivers a sentence; the card itself is the gift. A Porizo Valentine's song delivers a 75-second original song built around her specifically, in your own voice. Different format, different staying power.",
      },
      {
        q: "Will the song sound like me singing?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and every song is in your own voice. For a Valentine's song, hearing your voice is half the gift.",
      },
      {
        q: "What if Valentine's is tomorrow?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song this morning and send it tonight.",
      },
      {
        q: "Can I include our specific dates or the year?",
        a: "Yes. Include them in the memory you describe. The lyric weaves dates and year-counts in naturally.",
      },
      {
        q: "How is this priced vs Songfinch for a Valentine's gift?",
        a: "Songfinch is $179.99+ and ships in 4–7 days. Porizo is $9.99/month and ships in minutes, with voice cloning of the gifter — which Songfinch doesn't offer.",
      },
      {
        q: "Should I play it for her or send the link?",
        a: "Send the link first. Let her hear it alone. Then play it together later if the moment fits.",
      },
    ],
    internalLinks: [
      { url: "/gifts/valentines-song-for-him", text: "Valentine's song for him" },
      { url: "/gifts/love-song-for-girlfriend", text: "Love song for girlfriend" },
      { url: "/custom-song-gift", text: "Custom song gift" },
    ],
    utmCampaign: "valentines_song_her",
  },

  {
    slug: "valentines-song-for-him",
    metaTitle: "Valentine's Day Song for Him | Porizo",
    metaDescription:
      "Make a personalized Valentine's song for him — original lyrics built around your shared story, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Valentine's song for him",
    h1: "A Valentine's song he'll actually keep.",
    lede:
      "Men's Valentine's gifts default to socks, cologne, or 'just dinner.' A Porizo Valentine's song works because it's about him — the way he says your name when he's tired, the joke from the third week, the song he refuses to skip in the car. Original lyrics, in your own voice, finished in about three minutes.",
    cardTag: "Valentine's — for him",
    cardTitle: "The Song He Won't Skip",
    cardLyric:
      `"You refuse to skip the same one song every drive / and now I am hoping this is the second one / and that the next two years sound like both of us."`,
    whyEyebrow: "Why Porizo for Valentine's",
    whyHeadline: "A Valentine's gift built for the man who hates Valentine's gifts.",
    whyBody:
      "Most men's Valentine's gifts are either too small (a card) or too generic (cologne, socks, a watch). A Porizo Valentine's song is specific to him — about his name, his ritual, the song he refuses to skip, the joke from a date you remember — and short enough that it doesn't feel like a performance. Sung in your own voice via voice cloning, which means he hears <em>you</em> singing him a song he can replay on his commute. Among the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Valentine's moments boyfriends and husbands actually keep.",
    bestForMoments: [
      "<strong>The first Valentine's together.</strong> Naming the early-relationship details before they fade.",
      "<strong>A Valentine's after a hard year.</strong> The repair year. The year a song does what a card can't.",
      "<strong>The 'we said no gifts' Valentine's.</strong> A surprise that lands because it's not a thing.",
      "<strong>A long-distance Valentine's.</strong> The link crosses everything instantly.",
      "<strong>A milestone Valentine's — 5, 10, 20 years.</strong> The year a song outlives the dinner.",
      "<strong>A Valentine's where you forgot last year.</strong> The acknowledgment without the apology.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one car ritual to a finished Valentine's song.",
    exampleStarRow: "For a husband — fifth Valentine's",
    exampleLyric:
      `"You refuse to skip the same one song every drive / and five years in I still don't ask why / I just hope this song earns the same protection / when it comes on at the end of February."`,
    exampleStyle: "Country · 75 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: 'He never skips one specific song on the radio — same one for five years.' Porizo built the song around that ritual and pointed it forward.",
    faqEyebrow: "FAQ",
    faqHeadline: "Valentine's song questions.",
    faqs: [
      {
        q: "What if he doesn't really like Valentine's Day?",
        a: "Most men who 'don't really do Valentine's' play these anyway. The reason is it's not a Valentine's gift — it's a song about him that happened to arrive on February 14. Different category.",
      },
      {
        q: "Will the song sound like me singing?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and every song is in your own voice. For a Valentine's song to a husband or boyfriend, your voice is what makes it land.",
      },
      {
        q: "What if Valentine's is today?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song this morning and send it before dinner.",
      },
      {
        q: "Can I include our anniversary or specific dates?",
        a: "Yes. Mention them in the memory you describe. The lyric weaves them in.",
      },
      {
        q: "How does this compare to a Songfinch Valentine's song?",
        a: "Songfinch is $179.99+ and ships in 4–7 days. Porizo is $9.99/month and ships in minutes, with voice cloning of the gifter — which Songfinch doesn't offer.",
      },
      {
        q: "Should I send the song privately or do something with it?",
        a: "Send it privately first. Most husbands play it once alone, then ask to listen with you. Let him hear it alone the first time.",
      },
    ],
    internalLinks: [
      { url: "/gifts/valentines-song-for-her", text: "Valentine's song for her" },
      { url: "/gifts/love-song-for-boyfriend", text: "Love song for boyfriend" },
      { url: "/custom-song-gift", text: "Custom song gift" },
    ],
    utmCampaign: "valentines_song_him",
  },

  {
    slug: "song-for-husband-birthday",
    metaTitle: "Birthday Song for Husband | Porizo",
    metaDescription:
      "A personalized birthday song for your husband — original lyrics built around who he is, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Birthday song for husband",
    h1: "Make him a birthday song that's actually about him.",
    lede:
      "Husbands are notoriously hard to shop for on their birthday. Another tie, another watch, another 'I don't really need anything.' A Porizo birthday song fixes the format problem by being specific — the way he makes coffee, the line he says when you're running late, the joke that has lasted ten years. Original lyrics, in your voice, finished in about three minutes.",
    cardTag: "Birthday — for him",
    cardTitle: "The Same Coffee for a Decade",
    cardLyric:
      `"You make coffee like the kitchen is yours alone / you have done it the same way for a decade / and I have been writing this song in my head / for at least nine of them."`,
    whyEyebrow: "Why Porizo for husband's birthday",
    whyHeadline: "A husband's birthday gift built for a man who doesn't want stuff.",
    whyBody:
      "Husbands often say 'don't get me anything' for their birthdays. A Porizo birthday song slips past that defense because it isn't a thing — it's a 75-second song about him, in your voice. The way he makes coffee. The thing he says when you're tired. The joke from the third year. Those become the lyric. Sung in your own voice via voice cloning, which he plays on his commute, on his morning run, in the car alone. Among the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Husband birthdays that earn their own song.",
    bestForMoments: [
      "<strong>A milestone birthday.</strong> 30, 40, 50, 60, 70 — the years that quietly mark a chapter.",
      "<strong>A first birthday married.</strong> The first one where the gift comes from inside the relationship.",
      "<strong>The 'we said no gifts' birthday.</strong> A surprise that lands because it's not a thing.",
      "<strong>A long-distance birthday.</strong> Travel, deployment, work. The link crosses the distance instantly.",
      "<strong>A surprise after a hard year.</strong> The year you got through. The song that says you noticed.",
      "<strong>A retirement-era birthday.</strong> A song about the decades that came before this chapter.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one ritual to a finished birthday song.",
    exampleStarRow: "For a husband's 50th birthday",
    exampleLyric:
      `"Fifty years of you / and you still make coffee like the kitchen is yours alone / you still text 'on my way' from two blocks out / and I am hoping the next fifty / sound exactly like the last."`,
    exampleStyle: "Acoustic · 80 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: 'He texts \"on my way\" from two blocks from home, every single day.' Porizo built a verse around the ritual and a chorus about fifty years of small loyalties.",
    faqEyebrow: "FAQ",
    faqHeadline: "Husband birthday song questions.",
    faqs: [
      {
        q: "What if his birthday is today?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song in the time it takes him to find his keys.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and every song is in your voice. For a husband's birthday song, your voice is the part that makes it stick.",
      },
      {
        q: "He says he doesn't want gifts. Will he like this?",
        a: "Yes. Husbands who refuse gifts almost always keep these songs. The reason is it's not a thing — it's a moment. He's not turning down a moment.",
      },
      {
        q: "Can I include our kids' names or our pets?",
        a: "Yes. Mention them in the memory you describe. The lyric weaves them in naturally.",
      },
      {
        q: "How does this compare to Songfinch for a husband's birthday?",
        a: "Songfinch is $179.99+ and ships in 4–7 days for a song from a human composer. Porizo is $9.99/month and ships in minutes with voice cloning — your own voice singing — which Songfinch doesn't offer.",
      },
      {
        q: "Should I give it at the party or privately?",
        a: "Send it privately the morning of his birthday. Let him hear it alone first. Then maybe play it together at dinner if he wants.",
      },
    ],
    internalLinks: [
      { url: "/gifts/song-for-wife-birthday", text: "Birthday song for wife" },
      { url: "/gifts/anniversary-song-for-husband", text: "Anniversary song for husband" },
      { url: "/birthday-song-maker", text: "Birthday song maker" },
    ],
    utmCampaign: "song_for_husband_birthday",
  },

  {
    slug: "song-for-wife-birthday",
    metaTitle: "Birthday Song for Wife | Porizo",
    metaDescription:
      "A personalized birthday song for your wife — original lyrics built around who she is, sung in your own voice. Finished in about three minutes.",
    eyebrow: "Birthday song for wife",
    h1: "Make her a birthday song that's actually about her.",
    lede:
      "Roses are easy. Reservations are easy. A song that names the specific thing about your wife — the laugh, the way she pours coffee, the joke from the third year — is harder, and that's why it lands. Porizo turns that one detail into a song, sung in your voice. Finished in about three minutes.",
    cardTag: "Birthday — for her",
    cardTitle: "Her Specific Tuesday",
    cardLyric:
      `"You pour coffee like every cup is the first one / you hum a different song every morning / and every birthday I have meant to say it / and only this year remembered how."`,
    whyEyebrow: "Why Porizo for wife's birthday",
    whyHeadline: "A wife's birthday gift that finally catches up with how you actually feel.",
    whyBody:
      "Wife birthday gifts blur together. Flowers, jewelry, dinner reservation, weekend trip. A Porizo birthday song flips the format by being specific — about her name, her ritual, the joke from the third year, the laugh you fell for. Those become the lyric. Sung in your own voice via voice cloning, which means when she plays it on the morning of her birthday she hears <em>you</em> — not a stranger, not a singer. Among the established human-composer gift services (Songfinch, Songlorious, Songheart, ForeverSong) none combine AI generation with voice cloning of the gifter. Porizo is the personalized-song app built for this exact moment.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Wife birthdays that earn their own song.",
    bestForMoments: [
      "<strong>A milestone birthday.</strong> 30, 40, 50, 60, 70 — the years that quietly mark something.",
      "<strong>A first birthday married.</strong> The first one where the gift comes from inside the relationship.",
      "<strong>A long-distance birthday.</strong> Travel, work, family. The link crosses everything.",
      "<strong>A surprise after a hard year.</strong> The year that asked something of her. The song that names it.",
      "<strong>The 'I forgot last year' birthday.</strong> The repair. The 'making it up' song.",
      "<strong>A birthday during a new chapter.</strong> A new baby, a new house, a new job. The song marks the transition.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one morning ritual to a finished birthday song.",
    exampleStarRow: "For a wife's 40th birthday",
    exampleLyric:
      `"Forty years of you / and you still pour coffee like every cup is the first one / you still hum a different song every morning / and I have been hoping for forty more / the same way I hoped for the first ten."`,
    exampleStyle: "Acoustic · 80 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: 'She hums a different song every morning while making coffee, never the same one twice.' Porizo built a verse around the ritual and a chorus about forty years of small surprises.",
    faqEyebrow: "FAQ",
    faqHeadline: "Wife birthday song questions.",
    faqs: [
      {
        q: "What if her birthday is tonight?",
        a: "Preview in under 90 seconds. Full song in about three minutes. You can finish the song in the time it takes her to get ready.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Record 6–10 short phrases once and every song is in your voice. For a wife's birthday, your voice is what makes the song land.",
      },
      {
        q: "What if I don't know what to write?",
        a: "You don't write the song. You give Porizo one specific moment or detail about her — a memory, a ritual, an inside joke — and Porizo builds the verse and chorus around that. You provide the moment; the lyric grows.",
      },
      {
        q: "Can I include the kids' names?",
        a: "Yes. Mention them in the memory or message you describe. The lyric weaves them in.",
      },
      {
        q: "How does this compare to Songfinch for a wife's birthday?",
        a: "Songfinch is $179.99+ and ships in 4–7 days. Porizo is $9.99/month and ships in minutes with voice cloning — your own voice singing — which Songfinch doesn't offer.",
      },
      {
        q: "Should I send the link or play it for her?",
        a: "Send the link the morning of her birthday so she can hear it alone first. Then play it together at dinner if the moment fits.",
      },
    ],
    internalLinks: [
      { url: "/gifts/song-for-husband-birthday", text: "Birthday song for husband" },
      { url: "/gifts/anniversary-song-for-wife", text: "Anniversary song for wife" },
      { url: "/birthday-song-maker", text: "Birthday song maker" },
    ],
    utmCampaign: "song_for_wife_birthday",
  },

  {
    slug: "best-friend-birthday-song",
    metaTitle: "Birthday Song for Best Friend | Porizo",
    metaDescription:
      "A personalized birthday song for your best friend — original lyrics about the friendship only you two have, sung in your own voice. Finished in minutes.",
    eyebrow: "Birthday song for best friend",
    h1: "Make your best friend a birthday song.",
    lede:
      "The best friend birthday gift is the hardest category. They already know everything about you. They've seen every gift idea you've had. A Porizo birthday song works because it's about the specific friendship you two have — the joke that has lasted a decade, the road trip that changed everything, the way only they laugh at your worst impression. Sung in your voice. Finished in three minutes.",
    cardTag: "Best friend birthday",
    cardTitle: "The Decade-Long Joke",
    cardLyric:
      `"You have laughed at the same one joke for ten years / and I have not figured out why it still works / so I wrote a song about you and the joke / and it is the closest I have come to saying thank-you."`,
    whyEyebrow: "Why Porizo for best-friend birthdays",
    whyHeadline: "A best-friend birthday gift that doesn't sound like a brand sent it.",
    whyBody:
      "Best friend birthday gifts default to two failure modes: too generic (a candle, a mug, a book they didn't want) or too inside-joke (a thing only they know about, which is sweet but doesn't last). A Porizo birthday song hits the middle — it names the specific friendship in lyric, sung in your voice, in a format they can replay. The decade-long inside joke. The trip you took at 23. The way they answer the phone every time. Those become the lyric. Among the established human-composer marketplaces (Songfinch, Songlorious, Songheart, ForeverSong) none offer voice cloning of the gifter — for a best-friend song, hearing <em>your</em> voice is the part that makes it real.",
    bestForEyebrow: "Best for",
    bestForHeadline: "Best-friend birthdays that earn their own song.",
    bestForMoments: [
      "<strong>A milestone birthday — 30, 40, 50.</strong> The years where 'happy birthday' on Instagram isn't enough.",
      "<strong>A friend who moved away.</strong> The decade of friendship that became a series of texts. A song that names what stayed.",
      "<strong>A best friend's first birthday married.</strong> The shift in the friendship. The song that says you noticed.",
      "<strong>A surprise birthday song from across the country.</strong> The link crosses anywhere.",
      "<strong>A best friend birthday after a hard year for them.</strong> The year you can't be there for in person. The song you can.",
      "<strong>The friend who 'hates a fuss.'</strong> A 60-second song they can play alone — sized exactly for the friend who hates parties.",
    ],
    exampleEyebrow: "Example",
    exampleHeadline: "From one decade-old joke to a finished birthday song.",
    exampleStarRow: "For a best friend's 35th",
    exampleLyric:
      `"You have laughed at the same one joke for ten years / and I have not figured out why it still works / I have been your worst impression / and your favorite excuse to leave the party / and now I want you to be the song you do not skip."`,
    exampleStyle: "Indie folk · 75 seconds · sung in the gifter's voice",
    exampleNote:
      "The lyric came from one detail: 'We have one joke from college that we have been telling for ten years, and neither of us can explain why it still works.' Porizo built the song around that.",
    faqEyebrow: "FAQ",
    faqHeadline: "Best-friend birthday song questions.",
    faqs: [
      {
        q: "What if my best friend isn't into emotional gifts?",
        a: "Porizo lets you pick the tone. A funny, upbeat 60-second song about your worst inside joke lands better for many friendships than a serious ballad. The genre and tone follow your lead.",
      },
      {
        q: "Will the song be in my voice?",
        a: "Yes — voice cloning is on Plus and Pro. Hearing your voice is what makes a best-friend song work — they recognize you the second they press play.",
      },
      {
        q: "Can I make it funny instead of sentimental?",
        a: "Absolutely. Pick a genre that fits the friendship — country storytelling, pop, hip-hop, indie. The lyric tone follows.",
      },
      {
        q: "What if we live in different countries?",
        a: "Send the link by text or any messaging app. The song plays in any browser. No install required. The link crosses time zones and country codes instantly.",
      },
      {
        q: "What if multiple friends want to give the same song together?",
        a: "Easy. Either one friend enrolls their voice and names everyone in the lyric, or each friend records a separate verse and you stitch them. Many group friends do the second.",
      },
      {
        q: "What if I want to play it at the party?",
        a: "Send the link by text to your phone, hand them the phone before they cut the cake, hit play. The song plays in any browser. No app required for them to listen.",
      },
    ],
    internalLinks: [
      { url: "/birthday-song-maker", text: "Birthday song maker" },
      { url: "/blog/birthday-song-gift-ideas", text: "Birthday song gift ideas" },
      { url: "/gifts/long-distance-song-gift", text: "Long-distance song gift" },
    ],
    utmCampaign: "best_friend_birthday_song",
  },
];

// ---------------------------------------------------------------------------
// HTML template
// ---------------------------------------------------------------------------

function renderJSONLD(cell) {
  const faqEntities = cell.faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  }));

  const graph = [
    {
      "@type": "Service",
      "@id": `${SITE_BASE}/gifts/${cell.slug}#service`,
      name: cell.metaTitle.replace(" | Porizo", ""),
      serviceType: cell.eyebrow,
      description: cell.metaDescription,
      provider: { "@type": "Organization", name: "Porizo", url: `${SITE_BASE}/` },
      areaServed: "Worldwide",
      audience: { "@type": "Audience", audienceType: "Gift givers" },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_BASE}/` },
        { "@type": "ListItem", position: 2, name: "Gifts", item: `${SITE_BASE}/gifts/` },
        { "@type": "ListItem", position: 3, name: cell.metaTitle.replace(" | Porizo", ""), item: `${SITE_BASE}/gifts/${cell.slug}` },
      ],
    },
    {
      "@type": "HowTo",
      name: `How to make a ${cell.eyebrow.toLowerCase()}`,
      description: "Three steps from one moment to a complete personalized song.",
      totalTime: "PT3M",
      step: [
        { "@type": "HowToStep", position: 1, name: "Tell one moment", text: "Share an inside joke, a real moment, a phrase only you two say. The lyric grows from that detail." },
        { "@type": "HowToStep", position: 2, name: "Pick a sound", text: "Choose pop, country, R&B, Afropop, folk, acoustic — whatever fits the person." },
        { "@type": "HowToStep", position: 3, name: "Send the song", text: "Share a link they can open at the dinner, the moment, or quietly later that night." },
      ],
    },
    { "@type": "FAQPage", mainEntity: faqEntities },
  ];

  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }, null, 2);
}

function renderHTML(cell) {
  const downloadUrl = `/download?utm_source=seo&utm_medium=programmatic&utm_campaign=${cell.utmCampaign}&utm_content=hero`;
  const ogTitle = cell.metaTitle.replace(" | Porizo", "");
  const moments = cell.bestForMoments
    .map((m) => `          <li>${m}</li>`)
    .join("\n");
  const faqs = cell.faqs
    .map(
      (f) => `          <h3>${f.q}</h3>
          <p>${f.a}</p>`,
    )
    .join("\n\n");
  const internalLinks = cell.internalLinks
    .map((l, i) => `<a href="${l.url}">${l.text}</a>${i < cell.internalLinks.length - 1 ? " ·" : ""}`)
    .join("\n          ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${cell.metaDescription}">
  <meta name="theme-color" content="#FBF7F2">
  <title>${cell.metaTitle}</title>
  <link rel="canonical" href="${SITE_BASE}/gifts/${cell.slug}">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${cell.metaDescription}">
  <meta property="og:url" content="${SITE_BASE}/gifts/${cell.slug}">
  <meta property="og:image" content="${SITE_BASE}/assets/og-song.png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Porizo">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${cell.metaDescription}">
  <meta name="twitter:image" content="${SITE_BASE}/assets/og-song.png">

  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/styles/main.css">

  <script type="application/ld+json">
${renderJSONLD(cell)}
  </script>
</head>
<body>
  <nav class="nav nav--static">
    <div class="container">
      <div class="nav__inner">
        <a href="/" class="nav__logo"><span class="nav__logo-text">Porizo</span></a>
        <div class="nav__links">
          <a href="/mothers-day-song" class="nav__link">Mother's Day</a>
          <a href="/anniversary-song-gift" class="nav__link">Anniversary</a>
          <a href="/custom-song-gift" class="nav__link">Custom song</a>
        </div>
        <a href="${downloadUrl}" class="nav__cta">Get the app</a>
      </div>
    </div>
  </nav>
  <main class="occasion-page">
    <section class="occasion-hero">
      <div class="container">
        <div class="occasion-hero__grid">
          <div>
            <span class="eyebrow">${cell.eyebrow}</span>
            <h1>${cell.h1}</h1>
            <p class="lede">${cell.lede}</p>
            <div class="occasion-hero__actions">
              <a href="${downloadUrl}" class="btn btn--primary">Create the song</a>
              <a href="/#how" class="btn btn--ghost">How it works</a>
            </div>
          </div>
          <div class="occasion-card" aria-label="Example song">
            <div class="occasion-card__tag">${cell.cardTag}</div>
            <h2>${cell.cardTitle}</h2>
            <p>${cell.cardLyric}</p>
            <div class="occasion-card__wave"><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container container--narrow">
        <div class="occasion-steps">
          <div><strong>1. Tell one moment</strong><span>Share an inside joke, a real moment, a phrase only you two say. The lyric grows from that detail.</span></div>
          <div><strong>2. Pick a sound</strong><span>Choose pop, country, R&amp;B, Afropop, folk, acoustic — whatever fits the person.</span></div>
          <div><strong>3. Send the song</strong><span>Share a link they can open at the dinner, the moment, or quietly later that night.</span></div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container container--narrow">
        <span class="eyebrow">${cell.whyEyebrow}</span>
        <h2 style="margin-top: var(--s-4);">${cell.whyHeadline}</h2>
        <p class="lede">${cell.whyBody}</p>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container container--narrow">
        <span class="eyebrow">${cell.bestForEyebrow}</span>
        <h2 style="margin-top: var(--s-4);">${cell.bestForHeadline}</h2>
        <ul style="margin-top: var(--s-4); line-height: 1.8;">
${moments}
        </ul>
      </div>
    </section>

    <section class="section">
      <div class="container container--narrow">
        <span class="eyebrow">${cell.exampleEyebrow}</span>
        <h2 style="margin-top: var(--s-4);">${cell.exampleHeadline}</h2>
        <div class="testimonial testimonial--featured" style="margin-top: var(--s-4);">
          <div class="testimonial__stars">${cell.exampleStarRow}</div>
          <blockquote class="testimonial__quote">${cell.exampleLyric}</blockquote>
          <div class="testimonial__author">
            <div class="testimonial__avatar">P</div>
            <div class="testimonial__meta"><span class="n">Style</span><span class="o">${cell.exampleStyle}</span></div>
          </div>
        </div>
        <p style="margin-top: var(--s-6);">${cell.exampleNote}</p>
      </div>
    </section>

    <section class="section section--tight">
      <div class="container container--narrow">
        <span class="eyebrow">${cell.faqEyebrow}</span>
        <h2 style="margin-top: var(--s-4);">${cell.faqHeadline}</h2>
        <div style="margin-top: var(--s-6);">
${faqs}
        </div>
        <p style="margin-top: var(--s-6); font-size: 0.95em; color: var(--color-text-secondary, #666);">
          Read more: ${internalLinks}
        </p>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Sitemap update
// ---------------------------------------------------------------------------

async function updateSitemap(slugs) {
  const xml = await fs.readFile(SITEMAP, "utf8");
  const newEntries = slugs
    .map(
      (s) => `  <url><loc>${SITE_BASE}/gifts/${s}</loc><lastmod>${TODAY}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
    )
    .join("\n");

  // Remove any existing /gifts/ entries, then insert before </urlset>
  const cleaned = xml.replace(/^\s*<url><loc>https:\/\/porizo\.co\/gifts\/[^<]*<\/loc>.*?<\/url>\s*$/gm, "");
  const updated = cleaned.replace("</urlset>", `${newEntries}\n</urlset>`);
  await fs.writeFile(SITEMAP, updated);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  let count = 0;
  for (const cell of CELLS) {
    const html = renderHTML(cell);
    const filepath = path.join(OUT_DIR, `${cell.slug}.html`);
    await fs.writeFile(filepath, html);
    console.log(`  ✓ wrote ${path.relative(ROOT, filepath)} (${html.length} bytes)`);
    count += 1;
  }

  await updateSitemap(CELLS.map((c) => c.slug));
  console.log(`  ✓ updated sitemap.xml with ${count} entries`);

  console.log(`\nDone. ${count} programmatic pages written to public/gifts/.`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
