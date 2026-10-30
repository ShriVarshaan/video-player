import { LANGUAGES } from '@shared/lang'
import type { SelectOption } from './Select'

export const LANGUAGE_OPTIONS: readonly SelectOption[] = LANGUAGES.map((l) => ({ value: l.code2, label: l.name }))
