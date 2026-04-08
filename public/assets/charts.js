(function () {
  const fmtNum = (v, d = 2) =>
    Number(v || 0).toLocaleString("es-PE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtMoney = (v) => `S/ ${fmtNum(v, 2)}`;

  function generatePalette(size) {
    const out = [];
    for (let i = 0; i < size; i += 1) {
      const hue = 35 + ((i * 22) % 280);
      const chroma = 0.12 + ((i % 4) * 0.015);
      out.push(`oklch(0.72 ${chroma.toFixed(3)} ${hue})`);
    }
    return out;
  }

  const chartStore = {
    stock: null,
    income: null,
    analysis: null,
  };

  function destroyChart(key) {
    if (chartStore[key]) {
      chartStore[key].destroy();
      chartStore[key] = null;
    }
  }

  function destroyAll() {
    destroyChart("stock");
    destroyChart("income");
    destroyChart("analysis");
  }

  function createStockChart(canvas, rows) {
    destroyChart("stock");
    const sorted = [...rows].sort((a, b) => b.stock - a.stock);
    const maxStock = sorted[0]?.stock || 1;
    const bg = sorted.map((item) => {
      const pct = item.stock / maxStock;
      return pct > 0.66
        ? "oklch(0.72 0.18 65)"
        : pct > 0.33
          ? "oklch(0.69 0.16 95)"
          : "oklch(0.66 0.15 155)";
    });
    chartStore.stock = new Chart(canvas, {
      type: "bar",
      data: {
        labels: sorted.map((r) => r.nombre),
        datasets: [
          {
            data: sorted.map((r) => r.stock),
            backgroundColor: bg,
            borderRadius: 8,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: "easeOutCubic" },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const item = sorted[ctx.dataIndex];
                return `${item.nombre}: ${fmtNum(item.stock, 0)} uds · ${fmtNum(item.ventas, 2)} ventas proyectadas`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { callback: (value) => Number(value).toLocaleString("es-PE") },
          },
          y: { ticks: { autoSkip: false } },
        },
      },
    });
  }

  function createIncomeChart(canvas, legendEl, rows, totals) {
    destroyChart("income");
    const sorted = [...rows].sort((a, b) => b.porcentaje - a.porcentaje);
    const palette = generatePalette(sorted.length);
    chartStore.income = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: sorted.map((r) => r.nombre),
        datasets: [
          {
            data: sorted.map((r) => r.ingresos),
            backgroundColor: palette,
            borderWidth: 0,
            cutout: "65%",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: "easeOutCubic" },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const row = sorted[ctx.dataIndex];
                return `${row.nombre}: ${fmtMoney(row.ingresos)} (${fmtNum(row.porcentaje, 2)}%)`;
              },
            },
          },
        },
      },
      plugins: [
        {
          id: "centerText",
          afterDraw(chart) {
            const { ctx } = chart;
            const p = chart.getDatasetMeta(0).data[0];
            if (!p) return;
            ctx.save();
            ctx.textAlign = "center";
            ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim();
            ctx.font = "700 14px Geist";
            ctx.fillText("Total", p.x, p.y - 12);
            ctx.font = "700 18px Geist Mono";
            ctx.fillText(fmtMoney(totals.ingresos), p.x, p.y + 14);
            ctx.restore();
          },
        },
      ],
    });

    legendEl.innerHTML = sorted
      .map(
        (row, idx) => `
          <div class="legend-row">
            <span class="legend-dot" style="background:${palette[idx]}"></span>
            <span>${row.nombre} · ${fmtNum(row.porcentaje, 2)}%</span>
            <span>${fmtMoney(row.ingresos)}</span>
          </div>
        `
      )
      .join("");
  }

  function createAnalysisChart(canvas, rows, totals) {
    destroyChart("analysis");
    const avgTicket = totals.ticket;
    const avgVentas = totals.ventas / rows.length;
    const palette = generatePalette(rows.length);
    chartStore.analysis = new Chart(canvas, {
      type: "bubble",
      data: {
        datasets: rows.map((row, idx) => ({
          label: row.nombre,
          data: [{ x: row.ticket, y: row.ventas, r: Math.max(4, (row.stock / totals.stock) * 32) }],
          backgroundColor: palette[idx],
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 900, easing: "easeOutCubic" },
        scales: {
          x: { title: { display: true, text: "Ticket promedio (S/)" } },
          y: { title: { display: true, text: "Ventas proyectadas" } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const row = rows[ctx.datasetIndex];
                return `${row.nombre}: ticket ${fmtMoney(row.ticket)} · ventas ${fmtNum(row.ventas, 2)}`;
              },
            },
          },
        },
      },
      plugins: [
        {
          id: "quadrants",
          afterDraw(chart) {
            const { ctx, scales } = chart;
            const x = scales.x.getPixelForValue(avgTicket);
            const y = scales.y.getPixelForValue(avgVentas);
            ctx.save();
            ctx.setLineDash([6, 6]);
            ctx.strokeStyle = "rgba(122,122,133,0.55)";
            ctx.beginPath();
            ctx.moveTo(x, scales.y.top);
            ctx.lineTo(x, scales.y.bottom);
            ctx.moveTo(scales.x.left, y);
            ctx.lineTo(scales.x.right, y);
            ctx.stroke();
            ctx.restore();
          },
        },
      ],
    });
  }

  window.DashboardCharts = {
    createStockChart,
    createIncomeChart,
    createAnalysisChart,
    destroyAll,
  };
})();
