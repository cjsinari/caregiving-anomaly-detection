import { useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import FilterBar from '../dashboard/FilterBar';
import { EmptyState, Panel } from '../components/States';
import { locations as locationsApi } from '../api/endpoints';
import { chartInk } from '../charts/palette';
import { useFilters } from '../dashboard/FilterContext';
import { useLive } from '../dashboard/LiveContext';
import { useInterval, useResource } from '../dashboard/useResource';
import './map.css';

/*
 * Where sign-ins came from, and which pairs could not both be true.
 *
 * ── What a map adds here, and what it does not ──
 *
 * A map is the wrong tool for most of this data: "which country" is a
 * categorical question that a bar chart answers better, and a scatter of dots
 * over Kenya says little that the events table does not. What a map genuinely
 * adds is the impossible-travel case — two points and the minutes between them
 * is a claim a reader checks at a glance, where the same thing in a table is
 * two city names and some arithmetic.
 *
 * So the legs are the subject of this screen and the points are context. The
 * legs are drawn on top, in the critical colour, and always labelled with the
 * distance and the elapsed time, because a red line on a map is not an
 * explanation.
 *
 * ── Honest about precision ──
 *
 * These coordinates come from an offline GeoIP database, which resolves a
 * mobile address to a city centroid at best and a country centroid at worst.
 * A dot is not where a person was; it is where their network provider appears
 * to be. The screen says so, rather than letting a precise-looking pin imply
 * precision the data does not have.
 */

/* Markers are sized by what happened, not by score: three states, three sizes,
   each also carrying its colour and its text in the tooltip. */
const RADIUS = { block: 9, step_up: 7, allow: 5 };

export default function MapPage() {
  const { filters, queryFor } = useFilters();
  const { revision, isLive } = useLive();
  const ink = chartInk();

  const query = queryFor({ limit: 500, severity: undefined, eventType: undefined, layer: undefined, search: undefined });
  const { data, error, loading, reload } = useResource(
    ({ signal }) => locationsApi.list(query, { signal }),
    [JSON.stringify(query), revision]
  );

  useInterval(() => reload(), 60_000, { enabled: !isLive });

  const points = data?.points || [];
  const legs = (data?.impossibleTravel || []).filter((leg) => leg.points);
  const legsWithoutPoints = (data?.impossibleTravel || []).length - legs.length;

  // Centre on the data when there is any, and on Kenya when there is not.
  const centre = useMemo(() => {
    if (!points.length) return [-1.2921, 36.8219];
    const lat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
    const lon = points.reduce((sum, p) => sum + p.lon, 0) / points.length;
    return [lat, lon];
  }, [points]);

  const colourFor = (action) => (
    action === 'block' ? ink.critical : action === 'step_up' ? ink.warning : ink.good
  );

  return (
    <>
      <FilterBar show={['window', 'role']} />

      <Panel
        loading={loading}
        error={error}
        onRetry={reload}
        isEmpty={!points.length && !legs.length}
        loadingLabel="Loading sign-in locations…"
        empty={(
          <EmptyState
            title="No locatable sign-ins"
            detail="No sign-in in this period resolved to a location. Sign-ins from localhost or a private network cannot be geolocated, which is normal in development."
          />
        )}
      >
        <div className="stack">
          <section className="card">
            <header className="card__header">
              <div>
                <h2 className="card__title">Sign-in locations</h2>
                <p className="card__subtitle">
                  {points.length} locatable sign-in{points.length === 1 ? '' : 's'}
                  {legs.length ? ` · ${legs.length} impossible-travel pair${legs.length === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <ul className="map-legend">
                <li><span className="map-legend__dot" style={{ background: ink.good }} aria-hidden="true" />Allowed</li>
                <li><span className="map-legend__dot" style={{ background: ink.warning }} aria-hidden="true" />Step-up</li>
                <li><span className="map-legend__dot" style={{ background: ink.critical }} aria-hidden="true" />Blocked</li>
                <li><span className="map-legend__line" style={{ background: ink.critical }} aria-hidden="true" />Impossible travel</li>
              </ul>
            </header>

            <div className="map">
              <MapContainer center={centre} zoom={points.length ? 5 : 6} scrollWheelZoom={false}>
                <TileLayer
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  maxZoom={18}
                />

                {points.map((point) => (
                  <CircleMarker
                    key={point.id}
                    center={[point.lat, point.lon]}
                    radius={RADIUS[point.action] || 5}
                    pathOptions={{
                      color: ink.surface,
                      weight: 2,          // a surface ring, so overlapping dots stay countable
                      fillColor: colourFor(point.action),
                      fillOpacity: 0.85,
                    }}
                  >
                    <Tooltip>
                      {[point.city, point.country].filter(Boolean).join(', ') || 'Unknown location'}
                      {point.riskScore !== null ? ` · score ${point.riskScore.toFixed(1)}` : ''}
                    </Tooltip>
                    <Popup>
                      <div className="map-pop">
                        <p className="map-pop__title">
                          {[point.city, point.country].filter(Boolean).join(', ') || 'Unknown location'}
                        </p>
                        <p className="map-pop__row">
                          {new Date(point.time).toLocaleString()}
                        </p>
                        <p className="map-pop__row">
                          {point.account ? `${point.account.fullName} (${point.account.role})` : 'No account recorded'}
                        </p>
                        <p className="map-pop__row">
                          {point.action === 'block' ? 'Blocked'
                            : point.action === 'step_up' ? 'Step-up required'
                            : 'Allowed'}
                          {point.riskScore !== null ? ` · risk ${point.riskScore.toFixed(1)}` : ''}
                          {point.succeeded ? '' : ' · did not complete'}
                        </p>
                        <p className="map-pop__ip">{point.ip}</p>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}

                {legs.map((leg) => (
                  <Polyline
                    key={leg.id}
                    positions={[
                      [leg.points.from.lat, leg.points.from.lon],
                      [leg.points.to.lat, leg.points.to.lon],
                    ]}
                    pathOptions={{ color: ink.critical, weight: 3, dashArray: '6 5', opacity: 0.9 }}
                  >
                    <Tooltip sticky>
                      {leg.distanceKm} km in {leg.elapsedMinutes} min
                      {leg.requiredSpeedKmh ? ` · ${leg.requiredSpeedKmh} km/h required` : ''}
                    </Tooltip>
                    <Popup>
                      <div className="map-pop">
                        <p className="map-pop__title">Impossible travel</p>
                        <p className="map-pop__row">{leg.explanation}</p>
                        <p className="map-pop__row">
                          {leg.account ? `${leg.account.fullName} (${leg.account.role})` : 'No account recorded'}
                        </p>
                        <p className="map-pop__row">{new Date(leg.time).toLocaleString()}</p>
                      </div>
                    </Popup>
                  </Polyline>
                ))}
              </MapContainer>
            </div>

            <p className="card__note">
              Coordinates come from an offline GeoIP database, which places a mobile address at a
              city centroid at best and a country centroid at worst. A dot is where a network
              provider appears to be, not where a person was — the impossible-travel checks already
              allow for that margin before flagging anything.
              {legsWithoutPoints > 0 && ` ${legsWithoutPoints} impossible-travel event${legsWithoutPoints === 1 ? '' : 's'} in this period predate${legsWithoutPoints === 1 ? 's' : ''} coordinates being recorded on the event, so no line is drawn for ${legsWithoutPoints === 1 ? 'it' : 'them'}.`}
            </p>
          </section>

          {legs.length > 0 && (
            <section className="card">
              <header className="card__header">
                <div>
                  <h2 className="card__title">Impossible travel in this period</h2>
                  <p className="card__subtitle">
                    Pairs of sign-ins too far apart to have been travelled between
                  </p>
                </div>
              </header>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Account</th>
                      <th>From</th>
                      <th>To</th>
                      <th className="num">Distance</th>
                      <th className="num">Elapsed</th>
                      <th className="num">Implied speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.impossibleTravel || []).map((leg) => (
                      <tr key={leg.id}>
                        <td className="nowrap">{new Date(leg.time).toLocaleString()}</td>
                        <td>{leg.account?.fullName || '—'}</td>
                        <td>{leg.from || '—'}</td>
                        <td>{leg.to || '—'}</td>
                        <td className="num">{leg.distanceKm != null ? `${leg.distanceKm} km` : '—'}</td>
                        <td className="num">{leg.elapsedMinutes != null ? `${leg.elapsedMinutes} min` : '—'}</td>
                        <td className="num">{leg.requiredSpeedKmh != null ? `${leg.requiredSpeedKmh} km/h` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </Panel>
    </>
  );
}
