/** أنواع ردود ‎/api/v1/data/‎ (‎system/api/dataadmin.py‎). */

export interface Perms {
  view: boolean
  add: boolean
  change: boolean
  delete: boolean
}

export interface CatalogModel {
  key: string
  name: string
  singular: string
  count: number
  perms: Perms
  /** جدول بسجل واحد من غير إضافة (إعدادات الموقع) */
  single: boolean
}

export interface CatalogApp {
  app: string
  label: string
  models: CatalogModel[]
}

export interface Cell {
  k: 'text' | 'bool' | 'date' | 'link'
  v: string | boolean
  url?: string
}

export interface Column {
  name: string
  label: string
  sortable: boolean
}

export interface FilterOption {
  value: string
  label: string
}

export interface ListFilter {
  name: string
  label: string
  kind: 'bool' | 'choice'
  options: FilterOption[]
}

export interface ModelInfo {
  key: string
  name: string
  singular: string
}

export interface ListResponse {
  model: ModelInfo
  perms: Perms
  columns: Column[]
  filters: ListFilter[]
  searchable: boolean
  rows: { id: number; title: string; cells: Cell[] }[]
  total: number
  page: number
  pages: number
  size: number
}

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'url'
  | 'password'
  | 'int'
  | 'decimal'
  | 'bool'
  | 'choice'
  | 'multichoice'
  | 'date'
  | 'datetime'
  | 'json'
  | 'image'
  | 'file'
  | 'fk'
  | 'm2m'
  | 'readonly'

export interface FieldInfo {
  name: string
  label: string
  kind: FieldKind
  required: boolean
  help: string
  readonly: boolean
  maxLength?: number
  choices?: { value: string; label: string }[]
  blank?: boolean
  related?: string
  decimalPlaces?: number
}

export interface Fieldset {
  title: string
  description: string
  fields: string[]
}

export interface Ref {
  id: number | string
  label: string
}

export interface FileValue {
  url: string
  name: string
}

export type FieldValue = string | number | boolean | null | Ref | Ref[] | FileValue | string[]
export type Values = Record<string, FieldValue>

export interface SchemaResponse {
  model: ModelInfo
  perms: Perms
  fields: FieldInfo[]
  fieldsets: Fieldset[]
  defaults?: Values
}

export interface InlineTable {
  title: string
  columns: string[]
  rows: Cell[][]
}

export interface ObjectResponse extends SchemaResponse {
  id: number
  title: string
  values: Values
  readonly: Record<string, Cell>
  inlines: InlineTable[]
}

export interface DeletePreview {
  items: { text: string; depth: number }[]
  counts: Record<string, number>
  protected: string[]
  permsNeeded: string[]
}
