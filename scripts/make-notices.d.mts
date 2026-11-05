export type NoticePackage = { name: string; version: string; license: string; text: string }
export function npmPackages(root: string, names: string[]): NoticePackage[]
export function sidecarPackages(root: string): NoticePackage[]
export function generateNotices(root: string): string
