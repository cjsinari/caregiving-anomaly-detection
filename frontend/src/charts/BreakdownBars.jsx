import { ChartFrame, FigureTable } from './ChartFrame';

/*
 * A small horizontal breakdown — by layer, by role.
 *
 * Deliberately not a Recharts chart. These are three to five labelled
 * quantities, which is the case where a chart library earns nothing: the bars
 * are divs, each one directly labelled with its own figure, and the labels are
 * ordinary text that wraps and reads correctly at any width. A plotted bar
 * chart here would add an axis nobody needs, a legend restating the row labels,
 * and a tooltip to recover the number that is already printed.
 *
 * It is also not a pie chart. Comparing five quantities is a length comparison,
 * which bars do accurately and angles do not.
 *
 * ── What is being counted ──
 *
 * `ofConcern` is the bar; the total is beside it as context. That is the whole
 * point of the breakdown: the resource layer handles the most traffic by far
 * and almost none of it is interesting, so a chart of raw volume would say
 * nothing about where attention is needed. Both figures are shown so the
 * proportion is visible rather than implied.
 */
export default function BreakdownBars({
  title, subtitle, rows, footnote, emptyLabel = 'Nothing recorded in this period.',
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const isEmpty = !rows.length || rows.every((r) => r.total === 0);

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      height="auto"
      footnote={footnote}
      table={(
        <FigureTable
          caption={title}
          columns={[
            { key: 'label', label: 'Group', render: (r) => r.label },
            { key: 'value', label: 'Of concern', numeric: true, render: (r) => r.value },
            { key: 'total', label: 'All events', numeric: true, render: (r) => r.total },
            {
              key: 'share',
              label: 'Share of concern',
              numeric: true,
              render: (r) => (r.total ? `${Math.round((r.value / r.total) * 100)}%` : '—'),
            },
          ]}
          rows={rows}
        />
      )}
    >
      {isEmpty ? (
        <p className="chart__empty secondary">{emptyLabel}</p>
      ) : (
        <ul className="breakdown">
          {rows.map((row) => (
            <li key={row.key} className="breakdown__row">
              <div className="breakdown__head">
                <span className="breakdown__label" title={row.description || undefined}>
                  {row.label}
                </span>
                <span className="breakdown__figure tabular">
                  <strong>{row.value}</strong>
                  <span className="muted small"> of {row.total}</span>
                </span>
              </div>
              <div className="breakdown__track">
                <div
                  className="breakdown__bar"
                  style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%` }}
                />
              </div>
              {row.description && <p className="breakdown__note">{row.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </ChartFrame>
  );
}
