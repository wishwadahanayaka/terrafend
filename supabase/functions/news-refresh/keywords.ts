// The words that decide whether a headline is about a disaster in Sri Lanka, in English, Sinhala and
// Tamil. Used only by logic.ts (judge). No imports and nothing Deno-only, so the tests can load it.
//
// NEEDS REVIEW BY A NATIVE SPEAKER: the Sinhala and Tamil lists were written by an AI, not a native
// speaker. They will miss word forms and may catch the wrong ones. Review them against the kept and
// dropped headlines that a dry run lists (see docs/news-feed.md).
//
// How the lists are used (see judge in logic.ts):
// - English terms match whole words. A * at the end lets the word go on ("evacuat*" matches
//   evacuated, evacuation). Sinhala and Tamil terms match anywhere, because endings stick onto words,
//   unless they end in | (the word must end there: "වැසි|" is rain, but not වැසියන්, residents).
// - strong: 2 points each, and it names the hazard. weak: 1 point each. A headline is kept at 2 points,
//   so two different weak words are enough ("rain" + "warning"), as long as one of them names a
//   hazard: "warning" + "alert" alone is not.
// - elephant words count as strong only when an incident word is in the same headline, so a story
//   about elephant policy isn't kept but "wild elephant attack" is.
// - negative: -3 (cricket, money, "flood of"). foreign: -3 unless a home word (Sri Lanka, a district,
//   a province) is there too. Cyclones and tsunamis skip the foreign rule, since a storm off India
//   can still reach the island.
// Matching ignores case and the zero-width joiners Sinhala uses inside letters (ශ්‍රී), so a list word
// typed with or without them matches either way.
// Tamil stems stop before a final ் or vowel sign where an ending changes it: கடல் (sea) becomes
// கடலுக்கு, so the stem is கடல; புயல் (storm) becomes புயலால், so it is புயல.

export type Hazard =
  | 'flood'
  | 'landslide'
  | 'cyclone'
  | 'rain'
  | 'wind_sea'
  | 'tsunami'
  | 'earthquake'
  | 'elephant'
  | 'road'
  | 'drought'
  | 'other'

// When a headline names several hazards, the first one in this list is the one it is filed under.
// The database's check on news_items.hazard allows exactly these (a test compares them).
export const HAZARDS: Hazard[] = [
  'tsunami',
  'cyclone',
  'landslide',
  'flood',
  'earthquake',
  'wind_sea',
  'rain',
  'elephant',
  'road',
  'drought',
  'other',
]

export type Term = readonly [term: string, hazard: Hazard]

export type Lists = {
  strong: Term[]
  weak: Term[]
  elephant: string[]
  incident: string[]
  negative: string[]
  foreign: string[]
  home: string[]
}

const DISTRICTS_EN = [
  'colombo', 'gampaha', 'kalutara', 'kandy', 'matale', 'nuwara eliya', 'galle', 'matara', 'hambantota',
  'jaffna', 'kilinochchi', 'mannar', 'vavuniya', 'mullaitivu', 'batticaloa', 'ampara', 'trincomalee',
  'kurunegala', 'puttalam', 'anuradhapura', 'polonnaruwa', 'badulla', 'monaragala', 'moneragala',
  'ratnapura', 'kegalle',
]

const en: Lists = {
  strong: [
    ['flood', 'flood'], ['floods', 'flood'], ['flooded', 'flood'], ['flooding', 'flood'], ['flash flood*', 'flood'],
    ['inundat*', 'flood'], ['submerged', 'flood'], ['spill gates', 'flood'], ['sluice gates', 'flood'],
    ['landslide*', 'landslide'], ['landslip*', 'landslide'], ['earth slip*', 'landslide'], ['mudslide*', 'landslide'],
    ['rock fall*', 'landslide'], ['rockfall*', 'landslide'], ['nbro', 'landslide'], ['nbri', 'landslide'],
    ['cyclone*', 'cyclone'], ['cyclonic', 'cyclone'], ['deep depression', 'cyclone'], ['depression in the bay', 'cyclone'],
    ['low-pressure area', 'cyclone'], ['low pressure area', 'cyclone'], ['low-pressure zone', 'cyclone'],
    ['low pressure zone', 'cyclone'], ['low-pressure system', 'cyclone'], ['low pressure system', 'cyclone'],
    ['heavy rain*', 'rain'], ['torrential', 'rain'], ['thundershower*', 'rain'], ['thunderstorm*', 'rain'],
    ['lightning strike*', 'rain'], ['struck by lightning', 'rain'], ['cloudburst*', 'rain'],
    ['strong winds', 'wind_sea'], ['gale*', 'wind_sea'], ['rough sea*', 'wind_sea'], ['storm surge*', 'wind_sea'],
    ['tidal surge*', 'wind_sea'], ['high waves', 'wind_sea'],
    ['tsunami*', 'tsunami'],
    ['earthquake*', 'earthquake'], ['tremor*', 'earthquake'],
    ['fallen tree*', 'road'], ['tree fell', 'road'], ['trees fell', 'road'], ['uprooted', 'road'],
    ['drought*', 'drought'],
    ['evacuat*', 'other'], ['displaced', 'other'], ['relief camp*', 'other'], ['safe locations', 'other'],
    ['disaster management', 'other'], ['dmc', 'other'], ['met department', 'other'],
    ['meteorology department', 'other'], ['department of meteorology', 'other'], ['red warning', 'other'],
    ['amber warning', 'other'],
  ],
  weak: [
    ['rain', 'rain'], ['rains', 'rain'], ['rainfall', 'rain'], ['showers', 'rain'], ['weather', 'rain'],
    ['monsoon', 'rain'], ['storm', 'rain'], ['storms', 'rain'], ['lightning', 'rain'],
    ['wind', 'wind_sea'], ['winds', 'wind_sea'], ['sea', 'wind_sea'], ['seas', 'wind_sea'], ['fishermen', 'wind_sea'],
    ['depression', 'cyclone'],
    ['water level*', 'flood'], ['reservoir*', 'flood'], ['overflow*', 'flood'],
    ['road closed', 'road'], ['roads closed', 'road'], ['road blocked', 'road'], ['roads blocked', 'road'],
    ['traffic disrupted', 'road'], ['traffic halted', 'road'],
    ['warning', 'other'], ['warnings', 'other'], ['alert', 'other'],
  ],
  elephant: ['wild elephant*', 'elephant*', 'tusker*'],
  incident: [
    'attack*', 'kill*', 'trampl*', 'injur*', 'dead', 'death*', 'died', 'road', 'roads', 'highway', 'train*',
    'rail*', 'crossing', 'damag*', 'rampag*', 'charged',
  ],
  negative: [
    'flood of', 'storm into', 'storms into', 'stormed into', 'storm out', 'storms out', 'stormed out', 'stormed off',
    'brainstorm*', 'cricket', 'wicket*', 't20', 'odi', 'test match', 'innings', 'investment*', 'political storm',
    'storm of criticism', 'mental', 'clinical', 'elephant in the room', 'white elephant', 'price*', 'tax*',
    'stock market', 'share market', 'stormers',
  ],
  // "us" is left out: lowercased, it is also the word "us"
  foreign: [
    'india', 'indian', 'tamil nadu', 'kerala', 'chennai', 'pakistan', 'bangladesh', 'china', 'chinese', 'japan',
    'philippines', 'vietnam', 'indonesia', 'malaysia', 'thailand', 'myanmar', 'nepal', 'maldives', 'usa', 'u.s.',
    'america*', 'uk', 'britain', 'europe*', 'spain', 'italy', 'france', 'germany', 'australia', 'new zealand',
    'yemen', 'gaza', 'israel', 'iran', 'taiwan', 'korea', 'mexico', 'brazil', 'africa*', 'turkey',
  ],
  home: [
    'sri lanka*', 'island', 'islandwide', 'island-wide', 'province', 'provinces', 'sabaragamuwa', 'uva',
    ...DISTRICTS_EN,
  ],
}

// NEEDS REVIEW BY A NATIVE SPEAKER
const si: Lists = {
  strong: [
    ['ගංවතුර', 'flood'], ['ගං වතුර', 'flood'], ['ජලයෙන් යට', 'flood'], ['යටවී', 'flood'], ['යට වී', 'flood'],
    ['ජලගැලීම', 'flood'], ['වාන් දොර', 'flood'], ['වාන් දම', 'flood'],
    ['නායයෑ', 'landslide'], ['නායයා', 'landslide'], ['නාය යෑ', 'landslide'], ['නාය යා', 'landslide'],
    ['නාය ගිය', 'landslide'], ['පස් කඳු', 'landslide'], ['ගල් පෙරළ', 'landslide'], ['nbro', 'landslide'],
    ['ජාතික ගොඩනැගිලි පර්යේෂණ', 'landslide'],
    ['සුළි සුළ', 'cyclone'], ['සුළිසුළ', 'cyclone'], ['සුළි කුණාටු', 'cyclone'], ['සුළිකුණාටු', 'cyclone'],
    ['අවපාත', 'cyclone'], ['අඩු පීඩන', 'cyclone'],
    ['තද වැසි', 'rain'], ['අධික වැසි', 'rain'], ['දැඩි වැසි', 'rain'], ['ගිගුරුම්', 'rain'], ['අකුණු', 'rain'],
    ['තද සුළං', 'wind_sea'], ['තද සුළඟ', 'wind_sea'], ['දැඩි සුළං', 'wind_sea'], ['රළු මුහුද', 'wind_sea'],
    ['මුහුද රළු', 'wind_sea'],
    ['මුහුදු රළු', 'wind_sea'],
    ['සුනාමි', 'tsunami'],
    ['භූ කම්පන', 'earthquake'], ['භූකම්පන', 'earthquake'],
    ['ගස් කඩා', 'road'], ['ගසක් කඩා', 'road'],
    ['නියඟ', 'drought'], ['නියං', 'drought'],
    ['අවතැන්', 'other'], ['ආරක්ෂිත ස්ථාන', 'other'], ['ආපදා', 'other'], ['රතු නිවේදන', 'other'],
    ['රතු අනතුරු', 'other'],
  ],
  weak: [
    ['වැසි|', 'rain'], ['වැස්ස', 'rain'], ['වර්ෂාපතන', 'rain'], ['කාලගුණ', 'rain'], ['මෝසම්', 'rain'], ['කුණාටු', 'rain'],
    ['සුළං', 'wind_sea'], ['සුළඟ', 'wind_sea'], ['මුහුද', 'wind_sea'], ['ධීවර', 'wind_sea'],
    ['ජල මට්ටම', 'flood'], ['ජලාශ', 'flood'],
    ['මාර්ග අවහිර', 'road'], ['මාර්ගය අවහිර', 'road'],
    ['අනතුරු ඇඟවී', 'other'], ['අනතුරු ඇඟවීම', 'other'],
  ],
  elephant: ['අලි', 'ඇතා', 'ඇතෙක්'],
  incident: ['ප්‍රහාර', 'පහර', 'මරු', 'මිය ගිය', 'මියගිය', 'මරා', 'තුවාල', 'මාර්ග', 'දුම්රිය', 'හානි'],
  // No word for "price" (මිල): it is also the start of මිලියන, million
  negative: ['ක්‍රිකට්', 'කඩුලු', 'ඉනිම', 'ලකුණු', 'කොටස් වෙළෙඳපොළ'],
  foreign: [
    'ඉන්දියා', 'පකිස්තාන', 'බංග්ලාදේශ', 'චීන', 'ජපාන', 'පිලිපීන', 'වියට්නාම', 'ඉන්දුනීසියා', 'තායිලන්ත',
    'මියන්මාර', 'නේපාල', 'මාලදිවයින', 'අමෙරිකා', 'ඇමෙරිකා', 'එක්සත් ජනපද', 'බ්‍රිතාන්‍ය', 'යුරෝප',
    'ස්පාඤ්ඤ', 'ඉතාලි', 'ප්‍රංශ', 'ජර්මනි', 'ඕස්ට්‍රේලියා', 'යේමන', 'ගාසා', 'ඊශ්‍රායල', 'ඉරාන', 'තායිවාන',
    'කොරියා',
  ],
  // "දිවයින" on its own is not here, because මාලදිවයින (the Maldives) contains it
  home: [
    'ශ්‍රී ලංකා', 'ලංකාව', 'ලංකාවේ', 'මෙරට', 'දිවයිනේ', 'දිවයින පුරා', 'පළාත්', 'පළාතේ', 'බස්නාහිර', 'සබරගමුව',
    'ඌව', 'වයඹ', 'නැගෙනහිර', 'උතුරු මැද',
    'කොළඹ', 'ගම්පහ', 'කළුතර', 'මහනුවර', 'මාතලේ', 'නුවරඑළිය', 'ගාල්ල', 'මාතර', 'හම්බන්තොට', 'යාපනය',
    'කිලිනොච්චි', 'මන්නාරම', 'වවුනියාව', 'මුලතිව්', 'මඩකලපුව', 'අම්පාර', 'ත්‍රිකුණාමලය', 'කුරුණෑගල',
    'පුත්තලම', 'අනුරාධපුර', 'පොළොන්නරුව', 'බදුල්ල', 'මොණරාගල', 'රත්නපුර', 'කෑගල්ල',
  ],
}

// NEEDS REVIEW BY A NATIVE SPEAKER
const ta: Lists = {
  strong: [
    // Not வெள்ள on its own: வெள்ளை (white) and வெள்ளி (Friday, silver) start the same way
    ['வெள்ளம்', 'flood'], ['வெள்ளப்', 'flood'], ['வெள்ளத்', 'flood'], ['வெள்ள நீர்', 'flood'],
    ['வெள்ள அபாய', 'flood'], ['வெள்ள அனர்த்த', 'flood'], ['வெள்ள எச்சரிக்கை', 'flood'], ['வான் கதவு', 'flood'], ['வான்கதவு', 'flood'], ['வான் பாய', 'flood'],
    ['மண்சரிவ', 'landslide'], ['மண் சரிவ', 'landslide'], ['கற்பாறை சரி', 'landslide'], ['nbro', 'landslide'],
    ['சூறாவளி', 'cyclone'], ['புயல', 'cyclone'], ['தாழமுக்க', 'cyclone'], ['தாழ்வழுத்த', 'cyclone'],
    ['தாழ் அமுக்க', 'cyclone'], ['காற்றழுத்த தாழ்வு', 'cyclone'],
    ['கனமழை', 'rain'], ['கன மழை', 'rain'], ['பலத்த மழை', 'rain'], ['கடும் மழை', 'rain'], ['அடைமழை', 'rain'],
    ['இடி மின்னல்', 'rain'], ['இடியுடன் கூடிய மழை', 'rain'], ['மின்னல் தாக்க', 'rain'],
    ['பலத்த காற்ற', 'wind_sea'], ['கடும் காற்ற', 'wind_sea'], ['கொந்தளிப்ப', 'wind_sea'],
    ['சுனாமி', 'tsunami'],
    ['நிலநடுக்க', 'earthquake'], ['நில அதிர்வு', 'earthquake'],
    ['மரம் முறிந்து', 'road'], ['மரங்கள் முறிந்து', 'road'], ['மரம் சரிந்து', 'road'],
    ['வறட்சி', 'drought'],
    ['இடம்பெயர்', 'other'], ['பாதுகாப்பான இடங்', 'other'], ['அனர்த்த', 'other'], ['இடர் முகாமைத்துவ', 'other'],
    ['சிவப்பு எச்சரிக்கை', 'other'],
  ],
  weak: [
    ['மழை', 'rain'], ['வானிலை', 'rain'],
    ['காற்ற', 'wind_sea'], ['கடல', 'wind_sea'], ['மீனவர்', 'wind_sea'],
    ['நீர்மட்ட', 'flood'], ['நீர்த்தேக்க', 'flood'],
    ['போக்குவரத்து பாதிப்பு', 'road'], ['வீதி தடை', 'road'],
    ['எச்சரிக்கை', 'other'], ['வெளியேற்ற', 'other'],
  ],
  elephant: ['யானை'],
  incident: ['தாக்க', 'பலி', 'உயிரிழ', 'காயம', 'காயமடை', 'வீதி', 'ரயில்', 'புகுந்த', 'சேதம', 'சேதப்படுத்'],
  negative: ['கிரிக்கெட்', 'விக்கெட்', 'இன்னிங்ஸ்', 'ஓட்டங்க', 'பங்குச் சந்தை'],
  // "சீன" is spelled out as சீனா, because சீன is also the start of சீனி (sugar)
  foreign: [
    'இந்திய', 'தமிழ்நாடு', 'தமிழகம', 'சென்னை', 'கேரள', 'பாகிஸ்தான்', 'பங்களாதேஷ்', 'சீனா', 'ஜப்பான்',
    'பிலிப்பைன்ஸ்', 'வியட்நாம்', 'இந்தோனேசியா', 'தாய்லாந்து', 'மியன்மார்', 'நேபாள', 'மாலைதீவு', 'அமெரிக்க',
    'பிரித்தானிய', 'ஐரோப்பா', 'ஸ்பெயின்', 'இத்தாலி', 'பிரான்ஸ்', 'ஜேர்மனி', 'அவுஸ்திரேலியா', 'யேமன்', 'காசா',
    'இஸ்ரேல்', 'ஈரான்', 'தாய்வான்', 'கொரியா',
  ],
  // காலி (Galle) is left out: it is also the Tamil word for "empty"
  home: [
    'இலங்கை', 'நாடு முழுவதும்', 'நாட்டின்', 'தீவு முழுவதும்', 'மாகாண', 'சப்ரகமுவ', 'ஊவா', 'வடமேல்', 'வடமத்திய',
    'கொழும்பு', 'கம்பஹா', 'களுத்துறை', 'கண்டி', 'மாத்தளை', 'நுவரெலியா', 'மாத்தறை', 'அம்பாந்தோட்டை',
    'யாழ்ப்பாண', 'கிளிநொச்சி', 'மன்னார்', 'வவுனியா', 'முல்லைத்தீவு', 'மட்டக்களப்பு', 'அம்பாறை', 'திருகோணமலை',
    'குருநாகல்', 'புத்தளம்', 'அநுராதபுர', 'பொலன்னறுவை', 'பதுளை', 'மொனராகலை', 'இரத்தினபுரி', 'கேகாலை',
  ],
}

export const KEYWORDS: Record<'en' | 'si' | 'ta', Lists> = { en, si, ta }

// Links in these parts of a site are foreign news, whatever the headline says
export const WORLD_SECTIONS = ['/international/', '/world/', '/world-news/', '/foreign/', '/global/', '/உலக-செய்திகள்/']
