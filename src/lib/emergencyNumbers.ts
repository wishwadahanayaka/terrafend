// Every emergency number the app shows, in one place so they are easy to check and update.
// When one changes, edit it here, check its source again and move EMERGENCY_LAST_CHECKED
// to that day. The screen shows that date, and a test checks the list is still what it should be.

// A plain date (year-month-day) of the last time the numbers were checked
export const EMERGENCY_LAST_CHECKED = '2026-11-08'

// Where a number was checked. `official` is a page of the organisation itself. `secondary` is a
// news report or reference page, so it should be checked again against an official page.
export type EmergencySource = { kind: 'official' | 'secondary'; label: string; url: string }

export type EmergencyNumber = {
  id: string
  // Short numbers only work on a Sri Lankan SIM. Landlines work from anywhere.
  group: 'short' | 'landline'
  // What the phone dials: digits, with a leading + for the full international form
  number: string
  // How it is written on the screen (landlines are spaced to be easier to read)
  display: string
  // The name of the service, a translation key
  nameKey: string
  source: EmergencySource
}

const DMC_SITE: EmergencySource = {
  kind: 'official',
  label: 'Disaster Management Centre, Call Center section',
  url: 'https://www.dmc.gov.lk/',
}

// The first one is the one the screen puts first and makes biggest
export const EMERGENCY_NUMBERS: EmergencyNumber[] = [
  { id: 'dmc-117', group: 'short', number: '117', display: '117', nameKey: 'emergency.name.dmc117', source: DMC_SITE },
  {
    id: 'police-119',
    group: 'short',
    number: '119',
    display: '119',
    nameKey: 'emergency.name.police',
    source: {
      kind: 'secondary',
      label: 'Listed as the police emergency number by many sources; no official page checked yet',
      url: 'https://www.police.lk/',
    },
  },
  {
    id: 'fire-110',
    group: 'short',
    number: '110',
    display: '110',
    nameKey: 'emergency.name.fire',
    source: {
      kind: 'secondary',
      label: 'Listed as the fire number by many sources; no official page checked yet',
      url: 'https://en.wikipedia.org/wiki/Emergency_medical_services_in_Sri_Lanka',
    },
  },
  {
    id: 'ambulance-1990',
    group: 'short',
    number: '1990',
    display: '1990',
    nameKey: 'emergency.name.ambulance',
    source: {
      kind: 'secondary',
      label: 'Sunday Times, "1990 just a call away" (Suwa Seriya)',
      url: 'https://www.sundaytimes.lk/190804/plus/1990-just-a-call-away-360885.html',
    },
  },
  {
    id: 'dmc-landline-1',
    group: 'landline',
    number: '+94112136222',
    display: '+94 11 213 6222',
    nameKey: 'emergency.name.dmcLandline',
    source: DMC_SITE,
  },
  {
    id: 'dmc-landline-2',
    group: 'landline',
    number: '+94112670002',
    display: '+94 11 267 0002',
    nameKey: 'emergency.name.dmcLandline',
    source: DMC_SITE,
  },
  {
    id: 'police-disaster-desk',
    group: 'landline',
    number: '+94112421820',
    display: '+94 11 242 1820',
    nameKey: 'emergency.name.policeDesk',
    source: {
      kind: 'secondary',
      label: 'Ada Derana, police hotline for disaster relief (set up for disaster operations, may not be permanent)',
      url: 'https://adaderana.lk/news/99604/sri-lanka-police-establish-emergency-hotline-for-disaster-relief-operations-',
    },
  },
]

// What a tap on the button opens: the phone's dialler, or its "Call?" prompt
export const telHref = (number: string): string => `tel:${number}`

// For testing only: ?fakeEmergency=1 in the dev server swaps every number for this one, so the
// buttons can be tried without any chance of reaching a real emergency line.
export const FAKE_EMERGENCY_NUMBER = '0000000000'

export function fakeEmergencyRequested(search: string): boolean {
  return new URLSearchParams(search).get('fakeEmergency') === '1'
}

export function withFakeNumbers(list: EmergencyNumber[]): EmergencyNumber[] {
  return list.map((n) => ({ ...n, number: FAKE_EMERGENCY_NUMBER, display: FAKE_EMERGENCY_NUMBER }))
}

// The list the screen shows. The fake switch is inside an import.meta.env.DEV check, which the
// production build replaces with false and removes, so it can never work on the real site.
export function emergencyNumbers(): EmergencyNumber[] {
  if (import.meta.env.DEV && fakeEmergencyRequested(globalThis.location?.search ?? '')) {
    return withFakeNumbers(EMERGENCY_NUMBERS)
  }
  return EMERGENCY_NUMBERS
}
