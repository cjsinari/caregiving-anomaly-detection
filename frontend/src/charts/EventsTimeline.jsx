import { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { ChartFrame, FigureTable, Legend, TooltipCard } from './ChartFrame';
import { assignColours, chartInk, foldSeries } from './palette';

/*
 * Events over time, split into bands.
 *
 * ── Why a stacked area and not lines ──
 *
 * The question this chart answers is "how much is happening, and of what" —
 * a magnitude question with a part-to-whole component. Stacked bands answer it
 * directly: the silhouette is total volume, each band its share. Eight separate
 * lines would answer a different question (how does each type move
 * independently) less well, because at this density they overlap into a mess.
 *
 * ── Why not split by severity ──
 *
 * Because the four severity colours were measured against each other and the
 * high/medium pair separates by less than ordinary colour vision can resolve,
 * never mind a colour-vision deficiency. Stacked bands are adjacent fills, so
 * that pair would be two indistinguishable layers. Event type uses the
 * validated categorical palette, where adjacency was checked. Severity is
 * available as a filter instead, which narrows this chart rather than colouring
 * it.
 *
 * A 2px surface-coloured gap separates the bands, so where two fills meet there
 * is a visible edge rather than a colour change the reader has to detect.
 */
export default function EventsTimeline({ data, onDrillDown, bucketLabel }) {
  const [hidden, setHidden] = useState(() => new Set());
  const ink = chartInk();

  const { series, folded } = useMemo(
    () => foldSeries(data?.series || []),
    [data]
  );
  const colours = useMemo(() => assignColours(series.map((s) => s.key)), [series]);

  // Folding happens in the chart, so the folded keys have to be summed into the
  // synthetic band here too — the service returned them as their own series.
  const points = useMemo(() => {
    const foldedKeys = folded.map((s) => s.key);
    return (data?.points || []).map((point) => {
      const row = { at: point.at, time: point.time, total: point.total };
      for (const { key } of series) {
        row[key] = key === '__other'
          ? foldedKeys.reduce((sum, k) => sum + (point[k] || 0), 0)
          : (point[key] || 0);
      }
      return row;
    });
  }, [data, series, folded]);

  const visible = series.filter((s) => !hidden.has(s.key));
  const toggle = (key) => setHidden((current) => {
    const next = new Set(current);
    // Never let the last band be hidden: an empty plot with a full legend looks
    // like a failed request rather than a filter the reader applied.
    if (next.has(key)) next.delete(key);
    else if (visible.length > 1) next.add(key);
    return next;
  });

  const tickFormat = (at) => {
    const date = new Date(at * 1000);
    const daily = (data?.bucketSeconds || 3600) >= 86_400;
    return daily
      ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
      : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const isEmpty = !points.some((p) => p.total > 0);

  return (
    <ChartFrame
      title="Events over time"
      subtitle={`Grouped by event type, one point per ${bucketLabel || 'hour'}`}
      legend={<Legend series={series} colours={colours} onToggle={toggle} hidden={hidden} />}
      footnote={[
        onDrillDown ? 'Select a point to filter every view to that period.' : null,
        folded.length
          ? `"Other" combines ${folded.map((s) => s.label).join(', ')}.`
          : null,
        'Bands are event types, not severities: the severity colours are too close to each other to be told apart as adjacent fills. Filter by severity to narrow this chart.',
      ].filter(Boolean).join(' ')}
      table={(
        <FigureTable
          caption="Event counts per bucket"
          columns={[
            { key: 'time', label: 'Period', render: (r) => new Date(r.at * 1000).toLocaleString() },
            ...visible.map((s) => ({
              key: s.key, label: s.label, numeric: true, render: (r) => r[s.key] ?? 0,
            })),
            { key: 'total', label: 'Total', numeric: true, render: (r) => r.total },
          ]}
          rows={points.filter((p) => p.total > 0).map((p) => ({ ...p, key: p.at }))}
        />
      )}
    >
      {isEmpty ? (
        <p className="chart__empty secondary">No events were recorded in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 8, right: 8, bottom: 24, left: 8 }}
            onClick={(state) => {
              const point = state?.activePayload?.[0]?.payload;
              if (point && onDrillDown) onDrillDown(point);
            }}
          >
            <CartesianGrid stroke={ink.grid} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="at"
              tickFormatter={tickFormat}
              tick={{ fill: ink.muted, fontSize: 11 }}
              stroke={ink.axis}
              minTickGap={32}
              label={{
                value: 'Time', position: 'insideBottom', offset: -14,
                fill: ink.muted, fontSize: 11,
              }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: ink.muted, fontSize: 11 }}
              stroke={ink.axis}
              width={40}
              label={{
                value: 'Events', angle: -90, position: 'insideLeft',
                fill: ink.muted, fontSize: 11, style: { textAnchor: 'middle' },
              }}
            />
            <Tooltip
              cursor={{ stroke: ink.axis, strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const rows = payload
                  .filter((p) => p.value > 0)
                  .reverse()      // match the visual stacking order, top band first
                  .map((p) => ({
                    key: p.dataKey,
                    label: series.find((s) => s.key === p.dataKey)?.label || p.dataKey,
                    value: p.value,
                    colour: colours.get(p.dataKey),
                  }));
                const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
                return (
                  <TooltipCard
                    heading={new Date(label * 1000).toLocaleString()}
                    rows={[...rows, { key: '__total', label: 'Total', value: total }]}
                    note={onDrillDown ? 'Select to filter to this period.' : undefined}
                  />
                );
              }}
            />
            {visible.map(({ key }) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="events"
                stroke={colours.get(key)}
                strokeWidth={2}
                fill={colours.get(key)}
                fillOpacity={0.22}
                // The 2px surface-coloured join is the gap between bands.
                activeDot={{ r: 4, strokeWidth: 2, stroke: ink.surface }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
