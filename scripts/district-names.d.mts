export function districtNamesOf(districts: {
  features: { properties: { code: string; en: string; si: string; ta: string } }[]
}): Record<string, { en: string; si: string; ta: string }>
