import { useState, useMemo } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

const fmtNum = (v, d = 2) => Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtMoney = (v) => `S/ ${fmtNum(v, 2)}`

const COLUMNS = [
  { key: 'nombre', label: 'Familia', align: 'left', sortable: true },
  { key: 'stock', label: 'Stock', align: 'right', sortable: true, format: (v) => fmtNum(v, 0) },
  { key: 'cantidad', label: 'Cantidad', align: 'right', sortable: true },
  { key: 'ticket', label: 'Ticket', align: 'right', sortable: true, format: fmtMoney },
  { key: 'ventas', label: 'Ventas Proy.', align: 'right', sortable: true },
  { key: 'ingresos', label: 'Ingresos', align: 'right', sortable: true, format: fmtMoney },
  { key: 'porcentaje', label: '% Ingreso', align: 'right', sortable: true, format: (v) => `${fmtNum(v, 2)}%` },
]

export default function DataTable({ data, totals }) {
  const [sortBy, setSortBy] = useState('ingresos')
  const [sortDir, setSortDir] = useState('desc')

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      if (typeof aVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })
    return sorted
  }, [data, sortBy, sortDir])

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir('desc')
    }
  }

  const maxIngresos = Math.max(...data.map(d => d.ingresos))

  return (
    <div style={{ overflow: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th 
                key={col.key} 
                onClick={() => col.sortable && handleSort(col.key)}
                style={{ cursor: col.sortable ? 'pointer' : 'default' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', justifyContent: col.align }}>
                  {col.label}
                  {col.sortable && sortBy === col.key && (
                    sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map(row => (
            <tr key={row.nombre}>
              <td style={{ fontWeight: 500 }}>{row.nombre}</td>
              <td style={{ textAlign: 'right' }}>{fmtNum(row.stock, 0)}</td>
              <td style={{ textAlign: 'right' }}>{fmtNum(row.cantidad, 2)}</td>
              <td style={{ textAlign: 'right' }}>{fmtMoney(row.ticket)}</td>
              <td style={{ textAlign: 'right' }}>{fmtNum(row.ventas, 2)}</td>
              <td style={{ textAlign: 'right' }}>
                <div>
                  <div>{fmtMoney(row.ingresos)}</div>
                  <div className="income-bar-bg">
                    <div 
                      className="income-bar-fill" 
                      style={{ width: `${Math.max(1, (row.ingresos / maxIngresos) * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              </td>
              <td style={{ textAlign: 'right' }}>{fmtNum(row.porcentaje, 2)}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot style={{ background: 'var(--color-accent)', color: 'var(--color-text-inverse)' }}>
          <tr>
            <td style={{ fontWeight: 700 }}>TOTAL GENERAL</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(totals.stock, 0)}</td>
            <td style={{ textAlign: 'right' }}>—</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(totals.ticket)}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtNum(totals.ventas, 2)}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(totals.ingresos)}</td>
            <td style={{ textAlign: 'right', fontWeight: 600 }}>100.00%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
