import { useEffect, useRef } from 'react'

export default function StockBarChart({ data }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || data.length === 0 || !window.Chart) return

    const ctx = canvasRef.current.getContext('2d')
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const textColor = isDark ? '#a0a0a8' : '#52525b'
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

    // Sort by stock descending
    const sortedData = [...data].sort((a, b) => b.stock - a.stock)
    const maxStock = sortedData[0]?.stock || 1

    // Generate gradient colors based on stock percentage
    const bgColors = sortedData.map(item => {
      const pct = item.stock / maxStock
      if (pct > 0.66) {
        return isDark ? '#f59e0b' : '#d97706' // Amber
      } else if (pct > 0.33) {
        return isDark ? '#fbbf24' : '#f59e0b' // Yellow-gold
      } else {
        return isDark ? '#14b8a6' : '#0d9488' // Teal
      }
    })

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    chartRef.current = new window.Chart(ctx, {
      type: 'bar',
      data: {
        labels: sortedData.map(d => d.nombre),
        datasets: [{
          data: sortedData.map(d => d.stock),
          backgroundColor: bgColors,
          borderRadius: 8,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 700,
          easing: 'easeOutQuart'
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1a1a1e' : '#ffffff',
            titleColor: isDark ? '#e8e8ea' : '#18181b',
            bodyColor: isDark ? '#a0a0a8' : '#52525b',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (context) => {
                const item = sortedData[context.dataIndex]
                return [
                  `Stock: ${item.stock.toLocaleString('es-PE')} uds`,
                  `Ventas proyectadas: ${item.ventas.toFixed(2)}`,
                  `Ticket: S/ ${item.ticket.toFixed(2)}`
                ]
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { 
              color: textColor,
              callback: (value) => Number(value).toLocaleString('es-PE')
            }
          },
          y: {
            grid: { display: false },
            ticks: { 
              color: textColor,
              font: { size: 11 }
            }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
      }
    }
  }, [data])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
