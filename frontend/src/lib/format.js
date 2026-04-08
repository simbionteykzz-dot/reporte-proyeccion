const peLocale = 'es-PE'

export function fmtNum(v, decimals = 2) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString(peLocale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtInt(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Math.round(Number(v)).toLocaleString(peLocale)
}

export function fmtMoney(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `S/ ${fmtNum(v, 2)}`
}

export function fmtPercent(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `${fmtNum(v, 1)}%`
}
