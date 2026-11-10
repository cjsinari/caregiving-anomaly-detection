import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame, FigureTable, TooltipCard } from './ChartFrame';
import { chartInk } from './palette';

/*
 * Where the risk scores actually fall, and where the decision lines cut them.
 *
 * This is the chart that makes the thresholds arguable. On its own, "a score of
 * 61 required a step-up" is a fact about one sign-in; against the distribution
 * it becomes a question about how many ordinary sign-ins sit just above the
 * line, which is the question worth asking of a system that locks people out of
 * their care records.
 *
 * ── Colour here encodes the decision, not the series ──
 *
 * Each bar is one score band, filled by what the service did to sign-ins in it:
 * allowed, stepped up, blocked. Those are three states, so they take the
 * reserved status colours rather than categorical slots — and because status
 * colours never carry meaning alone, the two threshold lines are labelled with
 * their values and the bands are named in the tooltip and the table.
 *
 * ── One axis ──
 *
 * Count only. The obvious temptation is to overlay the block rate as a second
 * y-axis; two scales on one plot make any crossing point look meaningful when
 * it is an artefact of the scaling. The rate is in the tooltip instead.
 */
export default function AnomalyHistogram({ data }) {
  const ink = chartInk();
  const buckets = data?.histogram || [];
  const thresholds = data?.thresholds;

  const decisionColour = (bucket) => {
    // The dominant outcome in the band. A band is rarely mixed — the thresholds
    // are score-based — but a cold-start or rule-governed decision can put a
    // block in a low band, and the fill should show that rather than hide it.
    if (bucket.blocked >= bucket.steppedUp && bucket.blocked >= bucket.allowed) return ink.critical;
    if (bucket.steppedUp >= bucket.allowed) return ink.warning;
    return ink.good;
  };

  const isEmpty = !buckets.length;
  const fallback = thresholds?.source === 'fallback';

  return (
    <ChartFrame
      title="Risk score distribution"
      subtitle="Scored sign-in attempts, grouped into score bands"
      footnote={[
        thresholds
          ? `Sign-ins scoring up to ${thresholds.allowMax} are allowed, up to ${thresholds.stepUpMax} get a step-up challenge, and above that are blocked.`
          : null,
        fallback
          ? `These lines are the committed model defaults, not live values — the engine ${
            thresholds.reason === 'engine_unreachable' ? 'could not be reached' : 'reported none'}.`
          : null,
        'Bars are coloured by the decision most sign-ins in the band received. A block in a low band means a deterministic rule overrode the score.',
      ].filter(Boolean).join(' ')}
      table={(
        <FigureTable
          caption="Scored sign-ins per score band"
          columns={[
            { key: 'band', label: 'Score band', render: (r) => `${r.from}–${r.to}` },
            { key: 'count', label: 'Total', numeric: true, render: (r) => r.count },
            { key: 'allowed', label: 'Allowed', numeric: true, render: (r) => r.allowed },
            { key: 'stepped', label: 'Step-up', numeric: true, render: (r) => r.steppedUp },
            { key: 'blocked', label: 'Blocked', numeric: true, render: (r) => r.blocked },
          ]}
          rows={buckets.map((b) => ({ ...b, key: b.from }))}
        />
      )}
    >
      {isEmpty ? (
        <p className="chart__empty secondary">No sign-ins were scored in this period.</p>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets} margin={{ top: 8, right: 8, bottom: 24, left: 8 }}>
            <CartesianGrid stroke={ink.grid} strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="from"
              tickFormatter={(v) => String(v)}
              tick={{ fill: ink.muted, fontSize: 11 }}
              stroke={ink.axis}
              label={{
                value: 'Risk score', position: 'insideBottom', offset: -14,
                fill: ink.muted, fontSize: 11,
              }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: ink.muted, fontSize: 11 }}
              stroke={ink.axis}
              width={40}
              label={{
                value: 'Sign-ins', angle: -90, position: 'insideLeft',
                fill: ink.muted, fontSize: 11, style: { textAnchor: 'middle' },
              }}
            />
            <Tooltip
              cursor={{ fill: ink.grid, fillOpacity: 0.4 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const b = payload[0].payload;
                const rate = b.count ? Math.round((b.blocked / b.count) * 100) : 0;
                return (
                  <TooltipCard
                    heading={`Score ${b.from}–${b.to}`}
                    rows={[
                      { key: 'count', label: 'Sign-ins', value: b.count },
                      { key: 'allowed', label: 'Allowed', value: b.allowed, colour: ink.good },
                      { key: 'stepped', label: 'Step-up', value: b.steppedUp, colour: ink.warning },
                      { key: 'blocked', label: 'Blocked', value: b.blocked, colour: ink.critical },
                    ]}
                    note={b.count ? `${rate}% of this band was blocked.` : undefined}
                  />
                );
              }}
            />

            {/* The decision lines, labelled with their values: a status colour
                never carries meaning on its own. */}
            {thresholds && (
              <ReferenceLine
                x={thresholds.allowMax}
                stroke={ink.warning}
                strokeWidth={2}
                strokeDasharray="4 3"
                label={{
                  value: `step-up above ${thresholds.allowMax}`,
                  position: 'insideTopLeft', fill: ink.text, fontSize: 10,
                }}
              />
            )}
            {thresholds && (
              <ReferenceLine
                x={thresholds.stepUpMax}
                stroke={ink.critical}
                strokeWidth={2}
                strokeDasharray="4 3"
                label={{
                  value: `blocked above ${thresholds.stepUpMax}`,
                  position: 'insideTopRight', fill: ink.text, fontSize: 10,
                }}
              />
            )}

            <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {buckets.map((bucket) => (
                <Cell key={bucket.from} fill={decisionColour(bucket)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
