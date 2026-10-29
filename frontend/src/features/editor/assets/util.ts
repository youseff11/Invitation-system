import type { CSSProperties } from 'react'

import type { AssetRow } from '../types'

/** ‎background-image‎ لرابط (الاقتباس بيتهرّب عشان الرابط مايكسرش الـCSS). */
export const cssUrl = (url: string): CSSProperties => ({ backgroundImage: `url("${url.replace(/"/g, '%22')}")` })

/** مصغّرة حقيقية؟ السيرفر بيرجّع رابط الملف نفسه لما مفيش مصغّرة (فيديو قديم). */
export const realThumb = (asset?: AssetRow): string => (asset?.thumb && asset.thumb !== asset.url ? asset.thumb : '')
