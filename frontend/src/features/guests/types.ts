/** أشكال بيانات الضيوف والحضور — بتتطابق مع system/api/guests*.py. */

export type PassStatus = 'active' | 'used' | 'none'
export type RsvpStatus = 'attending' | 'declined' | 'maybe'
export type GuestSource = 'manual' | 'rsvp'

export interface InvitationBasic {
  id: number
  slug: string
  title: string
  nameOne: string
  nameTwo: string
}

export interface GuestRow {
  id: number
  name: string
  phone: string
  groupName: string
  plusOnesAllowed: number
  note: string
  token: string
  passCode: string
  source: GuestSource
  entriesAllowed: number
  entriesUsed: number
  entriesLeft: number
  passStatus: PassStatus
  checkedIn: boolean
  rsvpStatus: RsvpStatus | ''
}

export interface RsvpAnswer {
  q: string
  a: string
}

export interface RsvpRow {
  id: number
  name: string
  status: RsvpStatus
  companions: number
  message: string
  answers: RsvpAnswer[]
  createdAt: string
}

export interface GuestsPage {
  invitation: InvitationBasic & { venueToken: string; clientToken: string }
  stats: {
    guests: number
    entriesAllowed: number
    entriesUsed: number
    attending: number
    attendingPeople: number
    views: number
  }
  passEnabled: boolean
  guests: GuestRow[]
  rsvps: RsvpRow[]
}

export interface GuestInput {
  name: string
  phone: string
  groupName: string
  plusOnesAllowed: number | ''
  note: string
}

export interface ImportReport {
  created: number
  updated: number
  skipped: number
  total: number
  errors: string[]
  errorCount: number
}

export interface QrSheet {
  invitation: InvitationBasic
  rows: { id: number; name: string; groupName: string; plusOnesAllowed: number; svg: string }[]
}

export interface CheckinInfo {
  invitation: InvitationBasic
  arrived: number
  total: number
}

/** رد المسح الناجح (الفشل بييجي كـApiError بكود invalid_token / guest_not_found). */
export interface ScanData {
  already: boolean
  error: string
  id: number
  name: string
  code: string
  group: string
  companions: number
  used: number
  allowed: number
  left: number
  status: PassStatus
  rsvpStatus: RsvpStatus | ''
  at: string
  arrived: number
  total: number
}

// ---------------------------------------------------------------- القاعة
export interface VenueRow {
  id: number
  name: string
  code: string
  group: string
  allowed: number
  used: number
  left: number
  status: PassStatus
  checkedIn: boolean
  at: string
}

export interface VenueStats {
  guests: number
  arrived: number
  waiting: number
  allowed: number
  used: number
}

export interface VenueState {
  invitation: {
    slug: string
    title: string
    nameOne: string
    nameTwo: string
    venue: string
    eventAtLabel: string
  }
  rows: VenueRow[]
  stats: VenueStats
}

export interface VenueMarkResponse extends Pick<VenueState, 'rows' | 'stats'> {
  error: string
  guest: VenueRow
}

// ---------------------------------------------------------------- العميل
export interface ClientRsvpRow {
  id: number
  name: string
  status: RsvpStatus
  companions: number
  message: string
  answers: RsvpAnswer[]
  createdAt: string
}

export interface ClientFollowup {
  invitation: { slug: string; nameOne: string; nameTwo: string }
  hasRsvp: boolean
  hasQr: boolean
  hasGuestbook: boolean
  hasAnswers: boolean
  rsvpRows: ClientRsvpRow[]
  messageRows: { id: number; name: string; message: string; status: RsvpStatus; createdAt: string }[]
  qrRows: {
    id: number
    name: string
    passCode: string
    token: string
    entriesUsed: number
    entriesAllowed: number
  }[]
  stats: {
    rsvpTotal: number
    attending: number
    declined: number
    maybe: number
    companions: number
    guests: number
    checkedIn: number
    messages: number
  }
}

// ---------------------------------------------------------------- التصريح
export interface GuestPass {
  invitation: { slug: string; title: string; nameOne: string; nameTwo: string }
  guest: {
    name: string
    token: string
    passCode: string
    entriesAllowed: number
    entriesUsed: number
    entriesLeft: number
    passStatus: PassStatus
  }
  qrSvg: string
  pngUrl: string
  siteName: string
}
