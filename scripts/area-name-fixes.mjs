// Fixes to the Sinhala and Tamil names in the Survey Department's boundaries (HDX cod-ab-lka), used
// by build-areas.mjs. The output files are never edited by hand: a fix goes here.
//
// NEEDS REVIEW BY A NATIVE SPEAKER: the completed names below were written by an AI. Most only finish
// a word that was cut off (வடக்கு "north", නැගෙනහිර "east"), but each should be checked.

// The source keeps names in a 50-byte field (a shapefile limit). Sinhala and Tamil letters are 3 bytes
// each in UTF-8, so a long name stops after about 16 letters, often mid-word. A name at 48 to 50 bytes
// is treated as possibly cut off: it must be completed in CUT_OFF or listed in COMPLETE_AT_LIMIT, or
// the build stops.
export const LIMIT_BYTES = 48

// [p-code, language, the name as the source has it, the full name]
export const CUT_OFF = [
  ['LK1124', 'si', 'ශ්‍රී ජයවර්ධනපුර ක', 'ශ්‍රී ජයවර්ධනපුර කෝට්ටේ'],
  ['LK3130', 'ta', 'வெலிவிட்டிய திவித', 'வெலிவிட்டிய திவிதுர'],
  ['LK3233', 'si', 'කිරින්ද පුහුල්වැල', 'කිරින්ද පුහුල්වැල්ල'],
  ['LK3233', 'ta', 'கிரிந்தை புகுவெல்', 'கிரிந்தை புகுவெல்ல'],
  ['LK4106', 'si', 'වලිකාමම් බටහිර (චන', 'වලිකාමම් බටහිර (චන්කානෙයි)'],
  ['LK4109', 'si', 'වලිකාමම් නිරිත (සං', 'වලිකාමම් නිරිත (සංඩිලිප්පායි)'],
  ['LK4112', 'si', 'වලිකාමම් උතුර (තෙල', 'වලිකාමම් උතුර (තෙල්ලිප්පලෙයි)'],
  ['LK4115', 'si', 'වලිකාමම් දකුණ (උඩු', 'වලිකාමම් දකුණ (උඩුවිල්)'],
  ['LK4118', 'si', 'වලිකාමම් නැගෙනහිර', 'වලිකාමම් නැගෙනහිර (කෝපායි)'],
  ['LK4121', 'si', 'වඩමාරච්චි නිරිත (ක', 'වඩමාරච්චි නිරිත (කරවෙඩ්ඩි)'],
  ['LK4124', 'si', 'වඩමාරච්චි නැගෙනහි', 'වඩමාරච්චි නැගෙනහිර'],
  ['LK4127', 'si', 'වඩමාරච්චි උතුර (පේ', 'වඩමාරච්චි උතුර (පේදුරුතුඩුව)'],
  ['LK4130', 'si', 'තේන්මාරච්චි (ජාවකච', 'තේන්මාරච්චි (ජාවකච්චේරි)'],
  ['LK4312', 'ta', 'வெங்கலச்செட்டிக்', 'வெங்கலச்செட்டிக்குளம்'],
  ['LK4409', 'ta', 'புதுக்குடியிருப்', 'புதுக்குடியிருப்பு'],
  ['LK4503', 'si', 'පලෙයි (පච්චිලේපලෙය', 'පලෙයි (පච්චිලේපලෙයි)'],
  ['LK5103', 'ta', 'கோறளைப் பற்று வடக்', 'கோறளைப் பற்று வடக்கு'],
  ['LK5106', 'ta', 'கோறளைப் பற்று மேற்', 'கோறளைப் பற்று மேற்கு'],
  ['LK5110', 'ta', 'கோறளைப் பற்று தெற்', 'கோறளைப் பற்று தெற்கு'],
  ['LK5130', 'ta', 'மண்முனை தென் மேற்க', 'மண்முனை தென் மேற்கு'],
  ['LK5136', 'si', 'මාන්මුනේ දකුණ සහ එ', 'මාන්මුනේ දකුණ සහ එරුවිල් පත්තුව'],
  ['LK5136', 'ta', 'மண்முனை தெற்கும் எ', 'மண்முனை தெற்கும் எருவில் பற்றும்'],
  ['LK5333', 'ta', 'வெருகல் - ஈச்சிலம்', 'வெருகல் - ஈச்சிலம்பற்று'],
  ['LK6145', 'ta', 'பண்டவஸ்நுவரை மேற்', 'பண்டவஸ்நுவரை மேற்கு'],
  ['LK6148', 'si', 'පඩුවස්නුවර නැගෙනහ', 'පඩුවස්නුවර නැගෙනහිර'],
  ['LK6148', 'ta', 'பண்டவஸ்நுவரை கிழக', 'பண்டவஸ்நுவரை கிழக்கு'],
  ['LK6169', 'si', 'කුලියාපිටිය නැගෙන', 'කුලියාපිටිය නැගෙනහිර'],
  ['LK6169', 'ta', 'குளியாப்பிட்டி கி', 'குளியாப்பிட்டி கிழக்கு'],
  ['LK6172', 'ta', 'குளியாப்பிட்டி மே', 'குளியாப்பிட்டி மேற்கு'],
  ['LK7106', 'ta', 'கெப்பிட்டிக்கொல்', 'கெப்பிட்டிக்கொல்லாவ'],
  ['LK7115', 'si', 'නුවරගම් පළාත මධ්‍ය', 'නුවරගම් පළාත මධ්‍යම'],
  ['LK7115', 'ta', 'நுவரகமை பலாத்தை மத', 'நுவரகமை பலாத்தை மத்தி'],
  ['LK7133', 'si', 'නුවරගම් පළාත නැගෙන', 'නුවරගම් පළාත නැගෙනහිර'],
  ['LK7133', 'ta', 'நுவரகமை பலாத்தை கி', 'நுவரகமை பலாத்தை கிழக்கு'],
]

// Names at the byte limit that were checked and are whole: [p-code, language]
export const COMPLETE_AT_LIMIT = [
  ['LK2221', 'si'], ['LK2221', 'ta'],
  ['LK3130', 'si'],
  ['LK3318', 'si'], ['LK3318', 'ta'],
  ['LK4103', 'si'], ['LK4103', 'ta'],
  ['LK4106', 'ta'], ['LK4109', 'ta'], ['LK4112', 'ta'], ['LK4115', 'ta'], ['LK4118', 'ta'],
  ['LK4121', 'ta'], ['LK4124', 'ta'], ['LK4127', 'ta'], ['LK4130', 'ta'],
  ['LK4312', 'si'], ['LK4409', 'si'], ['LK4503', 'ta'],
  ['LK5103', 'si'], ['LK5104', 'si'], ['LK5104', 'ta'], ['LK5106', 'si'], ['LK5110', 'si'],
  ['LK5130', 'si'], ['LK5333', 'si'],
  ['LK6145', 'si'], ['LK6172', 'si'],
  ['LK6221', 'si'], ['LK6221', 'ta'],
  ['LK7106', 'si'],
  ['LK7121', 'si'], ['LK7121', 'ta'], ['LK7127', 'si'], ['LK7127', 'ta'],
  ['LK9224', 'si'], ['LK9224', 'ta'],
]

// Kalutara is written කඵතර: a legacy-font conversion error (ඵ in place of ළු), in the district and the DS
export const MISENCODED = [['කඵතර', 'කළුතර']]

// Known oddities left as they are, listed so they aren't rediscovered. The right replacement needs a
// native speaker.
export const NAME_NOTES = [
  'Gangawata Korale (Kandy Four Gravets and Gangawata Korale) is கண்டி in Tamil, the same as the Kandy district.',
  'Galle Four Gravets is காலி in Tamil, the same as the Galle district (and காலி also means "empty"); in Sinhala it is කඩවත්සතර ("four gravets") without Galle.',
  'Trincomalee district is ත්‍රිකුණාමළය in Sinhala (with ළ); ත්‍රිකුණාමලය (with ල) is also common.',
  'Nuwara Eliya district is நுவரேலியா in Tamil; நுவரெலியா is the more common spelling.',
  'Sri Jayawardanapura Kotte is ஸ்ரீ ஜயவர்தனபுர in Tamil, without கோட்டை (Kotte). It is under the byte limit, so it was written that way, not cut off.',
]
