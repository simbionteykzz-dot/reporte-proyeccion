import { useState, useCallback } from 'react'

const currentYear = new Date().getFullYear()
const today = new Date().toISOString().slice(0, 10)

export function useReportData() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dateFrom, setDateFrom] = useState(`${currentYear}-01-01`)
  const [dateTo, setDateTo] = useState(today)

  const fetchReport = useCallback(async (from, to) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set('date_from', from)
      if (to) params.set('date_to', to)
      const res = await fetch(`/api/reporte_tabla?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (err) {
      setError(err.message)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const load = useCallback(() => {
    fetchReport(dateFrom, dateTo)
  }, [fetchReport, dateFrom, dateTo])

  return { data, loading, error, dateFrom, dateTo, setDateFrom, setDateTo, load }
}
