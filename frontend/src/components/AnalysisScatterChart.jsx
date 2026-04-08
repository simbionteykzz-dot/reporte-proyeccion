import { useEffect, useRef } from 'react'

export default function AnalysisScatterChart({ data, totals }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || data.length === 0 || !window.Chart) return

    const ctx = canvasRef.current.getContext('2d')
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    const textColor = isDark ? '#a0a0a8' : '#52525b'
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

    const avgTicket = totals.ticket
    const avgVentas = totals.ventas / data.length
    const maxStock = Math.max(...data.map(d => d.stock))

    // Generate colors based on ingresos
    const getColor = (ingresos) => {
      const pct = ingresos / (totals.ingresos / data.length)
      if (pct > 1.5) {
        return isDark ? '#f59e0b' : '#d97706' // High - Amber
      } else if (pct > 0.8) {
        return isDark ? '#fbbf24' : '#f59e0b' // Medium
      } else {
        return isDark ? '#3b82f6' : '#2563eb' // Low - Blue
      }
    }

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    chartRef.current = new window.Chart(ctx, {
      type: 'bubble',
      data: {
        datasets: data.map(item => ({
          label: item.nombre,
          data: [{
            x: item.ticket,
            y: item.ventas,
            r: Math.max(4, (item.stock / maxStock) * 30)
          }],
          backgroundColor: getColor(item.ingresos),
          borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
          borderWidth: 1
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 900,
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
                const item = data[context.datasetIndex]
                return [
                  item.nombre,
                  `Ticket: S/ ${item.ticket.toFixed(2)}`,
                  `Ventas: ${item.ventas.toFixed(2)}`,
                  `Stock: ${item.stock.toLocaleString('es-PE')} uds`,
                  `Ingresos: S/ ${item.ingresos.toLocaleString('es-PE', { minimumFractionDigits: 2 })}`
                ]
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Ticket Promedio (S/)',
              color: textColor,
              font: { size: 12, weight: 500 }
            },
            grid: { color: gridColor },
            ticks: { color: textColor }
          },
          y: {
            title: {
              display: true,
              text: 'Ventas Proyectadas',
              color: textColor,
              font: { size: 12, weight: 500 }
            },
            grid: { color: gridColor },
            ticks: { color: textColor }
          }
        }
      },
      plugins: [{
        id: 'quadrants',
        afterDraw(chart) {
          const { ctx, scales: { x, y }, chartArea: { top, bottom, left, right } } = chart
          
          ctx.save()
          ctx.setLineDash([6, 6])
          ctx.strokeStyle = isDark ? 'rgba(122,122,133,0.4)' : 'rgba(100,100,110,0.3)'
          ctx.lineWidth = 1

          // Vertical line at avg ticket
          const xPos = x.getPixelForValue(avgTicket)
          ctx.beginPath()
          ctx.moveTo(xPos, top)
          ctx.lineTo(xPos, bottom)
          ctx.stroke()

          // Horizontal line at avg ventas
          const yPos = y.getPixelForValue(avgVentas)
          ctx.beginPath()
          ctx.moveTo(left, yPos)
          ctx.lineTo(right, yPos)
          ctx.stroke()

          // Labels
          ctx.fillStyle = isDark ? '#6e6e78' : '#71717a'
          ctx.font = '11px Inter, sans-serif'
          ctx.fillText('Promedio', xPos + 4, top + 12)
          ctx.fillText('Promedio', left + 4, yPos - 4)

          ctx.restore()
        }
      }]
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
      }
    }
  }, [data, totals])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
