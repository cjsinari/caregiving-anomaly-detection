import { Link } from 'react-router-dom';
import './dashboard.css';

/*
 * A KPI tile: one number, what it was last period, and the change.
 *
 * ── Polarity is declared, never assumed ──
 *
 * "Up 40%" is good news for sign-ins, bad news for failed sign-ins, and
 * meaningless for sessions started. A tile that painted every rise green and
 * every fall red would tell an administrator that a doubling of blocked
 * sign-ins was an improvement — so each metric states whether up is good, bad,
 * or neither, and a neutral metric gets no colour at all.
 *
 * ── The arrow is not the only cue ──
 *
 * Direction is carried by an arrow glyph and by the words "more"/"fewer" in the
 * screen-reader text, with colour only reinforcing it. Status colours never
 * carry meaning alone, and a red-green pair is the specific case where that
 * rule matters most.
 *
 * ── No percentage from zero ──
 *
 * The service returns `trend: null` when the previous period was zero, because
 * growth from nothing has no percentage: rendering it as +100% reads as
 * "doubled" when it is in fact the first occurrence of something. The tile says
 * "none previously" instead, which is the actually interesting fact.
 */

const POLARITY = {
  neutral: { up: 'neutral', down: 'neutral' },
  upBad: { up: 'bad', down: 'good' },
  upGood: { up: 'good', down: 'bad' },
};

export default function StatTile({
  label, value, previous, trend, polarity = 'neutral', hint, href, onSelect, emphasis = false,
}) {
  const direction = trend === null || trend === undefined || trend === 0
    ? 'flat'
    : trend > 0 ? 'up' : 'down';

  const tone = direction === 'flat'
    ? 'neutral'
    : (POLARITY[polarity] || POLARITY.neutral)[direction];

  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–';

  const changeText = trend === null || trend === undefined
    ? (previous === 0 ? 'none previously' : 'no comparison')
    : trend === 0
      ? 'unchanged'
      : `${Math.abs(trend)}% ${trend > 0 ? 'more' : 'fewer'} than the previous period`;

  const body = (
    <>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{formatValue(value)}</span>
      <span className={`tile__change tile__change--${tone}`}>
        <span aria-hidden="true" className="tile__arrow">{arrow}</span>
        <span className="tile__change-text">{changeText}</span>
      </span>
      {hint && <span className="tile__hint">{hint}</span>}
    </>
  );

  const className = `tile${emphasis ? ' tile--emphasis' : ''}${href || onSelect ? ' tile--interactive' : ''}`;

  // A real link, so it can be opened in a new tab and reads as a destination
  // rather than as a button that happens to navigate.
  if (href) return <Link to={href} className={className}>{body}</Link>;
  if (onSelect) {
    return <button type="button" className={className} onClick={onSelect}>{body}</button>;
  }
  return <div className={className}>{body}</div>;
}

/**
 * Large standalone figures use proportional digits — tabular figures are for
 * columns that have to align vertically, which a tile is not.
 */
function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return value;
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}
