// Types for build-areas.mjs, so the tests can import its pieces
export type Area = { level: string; code: string; district?: string; en: string; si: string; ta: string }
export type ZipEntry = { name: string; method: number; compressed: number; size: number; local: number }

export declare const LICENCE: string
export declare const ATTRIBUTION: string
export declare const NAME_FIXES: { what: string; apply(area: Area): number }[]
export declare function zipEntries(buf: Buffer): ZipEntry[]
export declare function zipRead(buf: Buffer, entry: ZipEntry): Buffer
export declare function areaOf(feature: { properties: Record<string, unknown> }, level: 'ds' | 'district'): Area
export declare function applyFixes(areas: Area[]): number[]
export declare function unexplainedAtLimit(divisions: Area[]): string[]
export declare function problems(divisions: Area[], districts: Area[], features: { properties: { code: string }; geometry: unknown }[]): string[]
