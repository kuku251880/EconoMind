import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { init, use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import type { SeriesPoint } from './api'

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

export default function SeriesChart({ points, unit, name }: {
  points: SeriesPoint[]
  unit: string
  name: string
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
      grid: { left: 20, right: 20, top: 18, bottom: 14, containLabel: true },
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
        areaStyle: { color: 'rgba(8, 127, 104, 0.09)' },
      }],
    })
    const resize = new ResizeObserver(() => chart.resize())
    resize.observe(container.current)
    return () => {
      resize.disconnect()
      chart.dispose()
    }
  }, [points, name])

  return <div ref={container} className="h-72 w-full sm:h-88" role="img" aria-label={`${name}季度趋势，单位${unit}`} />
}
