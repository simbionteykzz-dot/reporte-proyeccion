import { useEffect, useRef } from 'react'

export default function RevenuePieChart({ data, totalIngresos }) {
  const canvasRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!canvasRef.current || data.length === 0 || !window.Chart) return

    const ctx = canvasRef.current.getContext('2d')
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark'

    // Sort by percentage descending
    const sortedData = [...data].sort((a, b) => b.porcentaje - a.porcentaje)

    // Generate palette with HSL
    const bgColors = sortedData.map((_, i) => {
      const hue = 35 + ((i * 22) % 280)
      const sat = isDark ? 70 : 60
      const light = isDark ? 55 : 50
      return `hsl(${hue}, ${sat}%, ${light}%)`
    })

    if (chartRef.current) {
      chartRef.current.destroy()
    }

    chartRef.current = new window.Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: sortedData.map(d => d.nombre),
        datasets: [{
          data: sortedData.map(d => d.ingresos),
          backgroundColor: bgColors,
          borderWidth: 0,
          cutout: '65%'
        }]
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
                const item = sortedData[context.dataIndex]
                return [
                  `${item.nombre}`,
                  `Ingresos: S/ ${item.ingresos.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  `Porcentaje: ${item.porcentaje.toFixed(2)}%`
                ]
              }
            }
          }
        }
      },
      plugins: [{
        id: 'centerText',
        afterDraw(chart) {
          const { ctx, chartArea: { top, bottom, left, right } } = chart
          const centerX = (left + right) / 2
          const centerY = (top + bottom) / 2

          ctx.save()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          // Label
          ctx.font = '500 13px Inter, sans-serif'
          ctx.fillStyle = isDark ? '#6e6e78' : '#71717a'
          ctx.fillText('Total Ingresos', centerX, centerY - 16)

          // Value
          ctx.font = '600 22px monospace'
          ctx.fillStyle = isDark ? '#e8e8ea' : '#18181b'
          ctx.fillText(
            `S/ ${totalIngresos.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
            centerX,
            centerY + 10
          )

          ctx.restore()
        }
      }]
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
      }
    }
  }, [data, totalIngresos])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
}
