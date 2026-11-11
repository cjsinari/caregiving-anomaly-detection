import { useId, useState } from 'react';
import './charts.css';

/*
 * The frame every chart sits in: title, legend, and the table behind it.
 *
 * ── Why the table is not optional ──
 *
 * Three of the eight validated light-mode colours fall below 3:1 against the
 * surface. That measurement comes with an obligation rather than a warning:
 * the figures have to be available without relying on telling the fills apart.
 * The table is that. It is also the answer to "is this chart lying to me",
 * which is a question an administrator is entitled to ask of a security
 * dashboard, and to the screen-reader case, which no amount of colour work
 * addresses.
 *
 * So every chart gets a "Show figures" toggle, and the same numbers the chart
 * drew appear as a real table. Not a fallback for when the chart fails — a
 * second view of the same data, always one click away.
 */
export function ChartFrame({
  title, subtitle, legend, children, table, footnote, actions, height = 280,
}) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  return (
    <section className="chart">
      <header className="chart__header">
        <div className="chart__heading">
          <h3 className="chart__title">{title}</h3>
          {subtitle && <p className="chart__subtitle">{subtitle}</p>}
        </div>
        <div className="chart__actions">
          {actions}
          {table && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setShowTable((v) => !v)}
              aria-expanded={showTable}
              aria-controls={tableId}
            >
              {showTable ? 'Hide figures' : 'Show figures'}
            </button>
          )}
        </div>
      </header>

      {legend}

      {/* The chart itself is hidden from screen readers: a Recharts SVG
          announces as a tree of unlabelled shapes. The table carries the same
          data in a form that reads properly, so pointing at it is more useful
          than describing the drawing. */}
      <div className="chart__plot" style={{ height }} aria-hidden="true">
        {children}
      </div>

      {table && (
        <div id={tableId} className={showTable ? 'chart__table' : 'sr-only'}>
          {table}
        </div>
      )}

      {footnote && <p className="chart__footnote">{footnote}</p>}
    </section>
  );
}

/**
 * The legend.
 *
 * Always present for two or more series — identity is never carried by colour
 * alone — and omitted for one, where the title already names what is drawn.
 */
export function Legend({ series, colours, onToggle, hidden = new Set() }) {
  if (!series || series.length < 2) return null;

  return (
    <ul className="legend">
      {series.map(({ key, label, total }) => {
        const isHidden = hidden.has(key);
        const content = (
          <>
            <span
              className="legend__swatch"
              style={{ background: colours.get(key) || 'var(--text-muted)' }}
              aria-hidden="true"
            />
            <span className="legend__label">{label}</span>
            {total !== undefined && <span className="legend__total tabular">{total}</span>}
          </>
        );

        return (
          <li key={key} className={`legend__item${isHidden ? ' legend__item--off' : ''}`}>
            {onToggle ? (
              <button
                type="button"
                className="legend__button"
                onClick={() => onToggle(key)}
                aria-pressed={!isHidden}
              >
                {content}
                <span className="sr-only">{isHidden ? '(hidden — show)' : '(shown — hide)'}</span>
              </button>
            ) : content}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A tooltip body shared by the charts.
 *
 * Values are in text tokens, never in the series colour: a coloured swatch
 * beside a label carries identity, and colouring the number as well makes the
 * figure itself harder to read for no added information.
 */
export function TooltipCard({ heading, rows, note }) {
  return (
    <div className="chart-tip">
      {heading && <p className="chart-tip__heading">{heading}</p>}
      <ul className="chart-tip__rows">
        {rows.map(({ key, label, value, colour }) => (
          <li key={key ?? label} className="chart-tip__row">
            {colour && <span className="chart-tip__swatch" style={{ background: colour }} aria-hidden="true" />}
            <span className="chart-tip__label">{label}</span>
            <span className="chart-tip__value tabular">{value}</span>
          </li>
        ))}
      </ul>
      {note && <p className="chart-tip__note">{note}</p>}
    </div>
  );
}

/** The figures a chart drew, as a table. */
export function FigureTable({ columns, rows, caption }) {
  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="chart__caption">{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.numeric ? 'num' : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'num' : undefined}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
