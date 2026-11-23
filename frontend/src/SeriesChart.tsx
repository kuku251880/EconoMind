import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import type { SeriesPoint } from './api'

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

type ChartPoint = Pick<SeriesPoint, 'period' | 'value'>

export default function SeriesChart({ points, unit, name, label, comparisons }: {
  points: ChartPoint[]
  unit: string
  name: string
  label?: string
  comparisons?: { name: string; points: ChartPoint[] }[]
}) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    const chart = init(container.current)
    const quarterIndex = (period: string) => Number(period.slice(0, 4)) * 4 + Number(period.at(-1)) - 1
    const samples = new Map(points.map((point) => [quarterIndex(point.period), Number(point.value)]))
    const start = quarterIndex(points[0].period)
    const end = quarterIndex(points.at(-1)!.period)
    const timeline = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
    chart.setOption({
      animation: false,
      grid: { left: 20, right: 20, top: comparisons ? 45 : 18, bottom: 14, containLabel: true },
      legend: comparisons ? { top: 5 } : undefined,
      tooltip: { trigger: 'axis', renderMode: 'richText' },
      xAxis: {
        type: 'category',
        boundaryGap: points.length === 1,
        data: timeline.map((quarter) => `${String(Math.floor(quarter / 4)).padStart(4, '0')}-Q${quarter % 4 + 1}`),
        axisLabel: { color: '#5f7069', hideOverlap: true },
        axisLine: { lineStyle: { color: '#cedbd3' } },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { color: '#5f7069', hideOverlap: true },
        splitLine: { lineStyle: { color: '#e3ebe5', type: 'dashed' } },
      },
      series: [{
        name, type: 'line', data: timeline.map((quarter) => samples.get(quarter) ?? null),
        symbolSize: 8, itemStyle: { color: '#087f68' }, lineStyle: { width: 3 },
        areaStyle: comparisons ? undefined : { color: 'rgba(8, 127, 104, 0.09)' },
      }, ...(comparisons ?? []).map((comparison, index) => {
        const values = new Map(comparison.points.map((point) => [quarterIndex(point.period), Number(point.value)]))
        const color = index === 0 ? '#536a9e' : '#a55019'
        return {
          name: comparison.name,
          type: 'line',
          data: timeline.map((quarter) => values.get(quarter) ?? null),
          itemStyle: { color },
          lineStyle: { width: 2, type: index === 0 ? 'dashed' : 'dotted' },
        }
      })],
    })
    const resize = new ResizeObserver(() => chart.resize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      chart.dispose()
    }
  }, [points, name, comparisons])

  return <div ref={container} className="h-72 w-full sm:h-88" role="img" aria-label={`${label ?? name + "季度趋势"}，单位${unit}`} />
}
