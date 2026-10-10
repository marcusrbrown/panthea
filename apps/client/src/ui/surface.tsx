import type { ModelEndpointStatus, Realm } from "@panthea/contracts";
import type { ReactNode } from "react";

import type { ModelSettingsTransport } from "../connection";
import {
  listTargets,
  type ObserverTarget,
  type ObserverView,
} from "../observer";
import { eventsInRealm } from "../renderer/presentation";
import type {
  ViewActor,
  ViewBuilding,
  ViewLocation,
  WorldViewModel,
} from "../store";
import { SettingsView } from "./settings";
import "./surface.css";

const REALM_LABEL: Record<Realm, string> = {
  mortal: "Mortal",
  olympus: "Olympus",
  underworld: "Underworld",
};

function title(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function duration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}

function inventoryText(actor: ViewActor | ViewBuilding): string {
  return actor.inventory.length
    ? actor.inventory
        .map(({ resource, amount }) => `${title(resource)} ${amount}`)
        .join(" · ")
    : "No stored resources";
}

function targetTitle(
  target: ObserverTarget | undefined,
  view: WorldViewModel | undefined,
): string {
  if (!target) return "No target selected";
  if (target.kind === "actor") {
    for (const locations of Object.values(view?.realms ?? {})) {
      for (const location of locations) {
        const actor = location.actors.find((item) => item.id === target.id);
        if (actor) return title(actor.id);
      }
    }
  } else {
    for (const locations of Object.values(view?.realms ?? {})) {
      const location = locations.find((item) => item.id === target.id);
      if (location) return location.name;
    }
  }
  return title(target.id);
}

function locationInRealm(
  view: WorldViewModel | undefined,
  realm: Realm,
  locationId: string | undefined,
): ViewLocation | undefined {
  return locationId
    ? view?.realms[realm].find((location) => location.id === locationId)
    : undefined;
}

function TargetPicker({
  view,
  onPick,
}: {
  view?: WorldViewModel;
  onPick?: (target: ObserverTarget) => void;
}) {
  if (!view)
    return <p className="empty-note">Waiting for a committed frame.</p>;
  return (
    <div className="target-groups">
      {listTargets(view).map((group) => (
        <section
          className="target-group"
          key={group.realm}
          aria-labelledby={`realm-${group.realm}`}
        >
          <h2 id={`realm-${group.realm}`}>{REALM_LABEL[group.realm]}</h2>
          {group.locations.map((location) => (
            <button
              className="target-option location-option"
              key={`location-${location.id}`}
              type="button"
              onClick={() => onPick?.({ kind: "location", id: location.id })}
            >
              <span className="target-glyph" aria-hidden="true">
                ⌖
              </span>
              <span>{location.name}</span>
              <small>Location</small>
            </button>
          ))}
          {group.actors.map((actor) => (
            <button
              className={`target-option actor-option${actor.alive ? "" : " is-dead"}`}
              key={`actor-${actor.id}`}
              type="button"
              onClick={() => onPick?.({ kind: "actor", id: actor.id })}
            >
              <span className="target-glyph" aria-hidden="true">
                {actor.alive ? "●" : "†"}
              </span>
              <span>{title(actor.id)}</span>
              <small>{actor.alive ? "Actor" : "Dead"}</small>
            </button>
          ))}
          {!group.locations.length && !group.actors.length && (
            <p className="empty-note">No targets</p>
          )}
        </section>
      ))}
    </div>
  );
}

function CatchUp({
  view,
  onDismiss,
}: {
  view?: WorldViewModel;
  onDismiss?: () => void;
}) {
  const summary = view?.catchUpSummary;
  if (!summary) return null;
  return (
    <section className="catch-up" aria-labelledby="catch-up-title">
      <div>
        <p className="eyebrow">Catch-up summary</p>
        <h2 id="catch-up-title">
          Caught up: {duration(summary.appliedMs)} applied,{" "}
          {duration(summary.skippedMs)} skipped
        </h2>
        {summary.majorOutcomes.length > 0 && (
          <ul>
            {summary.majorOutcomes.map((outcome) => (
              <li key={outcome}>{outcome}</li>
            ))}
          </ul>
        )}
      </div>
      <button
        className="dismiss-button"
        type="button"
        aria-label="Dismiss catch-up summary"
        onClick={onDismiss}
      >
        ×
      </button>
    </section>
  );
}

export interface ClientSurfaceProps {
  readonly view?: WorldViewModel;
  readonly observation: ObserverView;
  readonly scene?: ReactNode;
  readonly onPick?: (target: ObserverTarget) => void;
  readonly onDismissCatchUp?: () => void;
  readonly dismissedSummary?: boolean;
  readonly receiptErrors?: readonly string[];
  /** Canon art that could not be loaded; those actors draw as placeholders. */
  readonly artProblems?: readonly string[];
  readonly settingsOpen?: boolean;
  readonly onOpenSettings?: () => void;
  readonly onCloseSettings?: () => void;
  readonly settingsTransport?: ModelSettingsTransport;
  readonly endpointStatuses?: readonly ModelEndpointStatus[];
}

export function ClientSurface({
  view,
  observation,
  scene,
  onPick,
  onDismissCatchUp,
  dismissedSummary = false,
  receiptErrors = [],
  artProblems = [],
  settingsOpen = false,
  onOpenSettings,
  onCloseSettings,
  settingsTransport,
  endpointStatuses = [],
}: ClientSurfaceProps) {
  const realm =
    observation.kind === "following"
      ? observation.realm
      : observation.kind === "held" && observation.lastKnown
        ? observation.lastKnown.realm
        : "mortal";
  const locationId =
    observation.kind === "following"
      ? observation.locationId
      : observation.kind === "held"
        ? observation.lastKnown?.locationId
        : undefined;
  const location = locationInRealm(view, realm, locationId);
  const recentEvents = view ? eventsInRealm(view, realm) : [];
  const selectedTarget =
    observation.kind === "idle" ? undefined : observation.target;

  return (
    <main className="panthea-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href="#world"
          aria-label="Panthea world observer"
        >
          <span className="wordmark-mark">P</span>
          <span>Panthea</span>
        </a>
        <div className="topbar-meta">
          <span className="world-label">Living world</span>
          <span className="meta-divider" />
          <span>Tick {view?.tick ?? "—"}</span>
          <span className="meta-divider" />
          <span>Event {view?.sequence ?? "—"}</span>
        </div>
        <button
          className="settings-nav-button"
          type="button"
          onClick={onOpenSettings}
          aria-current={settingsOpen ? "page" : undefined}
        >
          Settings
        </button>
        <span className="read-only-label">
          <span aria-hidden="true">◉</span> Read only
        </span>
      </header>

      {view?.status === "degraded" && (
        <div
          className={`status-banner ${
            view.degradedReason === "model-degraded"
              ? "model-degraded-banner"
              : "degraded-banner"
          }`}
          role="status"
        >
          <span className="status-dot" />
          {view.degradedReason === "model-degraded" ? (
            <strong>Models unavailable — world running</strong>
          ) : (
            <>
              <strong>World degraded</strong>
              <span>{view.degradedReason ?? "Service is recovering"}</span>
            </>
          )}
        </div>
      )}
      {view?.status === "paused" && (
        <div className="status-banner paused-banner" role="status">
          <span className="status-dot" />
          <strong>World paused</strong>
          <span>Time is suspended. Observation continues.</span>
        </div>
      )}

      {!dismissedSummary && (
        <CatchUp view={view} onDismiss={onDismissCatchUp} />
      )}

      {settingsOpen && settingsTransport ? (
        <SettingsView
          transport={settingsTransport}
          onBack={onCloseSettings}
          endpointStatuses={endpointStatuses}
        />
      ) : (
        <div className="workspace" id="world">
          <aside className="target-rail" aria-label="Observation targets">
            <div className="rail-heading">
              <p className="eyebrow">Observer</p>
              <h1>Choose a view</h1>
            </div>
            <div className="following-state">
              <span className="following-indicator" aria-hidden="true" />
              <div>
                <small>Following</small>
                <strong>
                  {observation.kind === "idle"
                    ? "Nothing yet"
                    : targetTitle(selectedTarget, view)}
                </strong>
              </div>
            </div>
            {observation.kind === "held" && (
              <div className="hold-banner" role="status">
                <strong>Lost sight: {observation.reason}</strong>
                {observation.lastKnown && (
                  <span>
                    Holding at{" "}
                    {locationInRealm(
                      view,
                      observation.lastKnown.realm,
                      observation.lastKnown.locationId,
                    )?.name ?? title(observation.lastKnown.locationId)}
                  </span>
                )}
              </div>
            )}
            <TargetPicker view={view} onPick={onPick} />
            <p className="rail-footnote">Selection changes only this view.</p>
          </aside>

          <section
            className="scene-column"
            aria-label={`${REALM_LABEL[realm]} world view`}
          >
            <div className={`scene-heading realm-${realm}`}>
              <div>
                <p className="eyebrow">Observed realm</p>
                <h2>{REALM_LABEL[realm]}</h2>
              </div>
              <div className="scene-state">
                <span className="scene-state-dot" />
                {view?.status === "paused"
                  ? "Paused"
                  : view?.status === "degraded" &&
                      view.degradedReason !== "model-degraded"
                    ? "Degraded"
                    : "Live"}
              </div>
            </div>
            <div className="scene-stage" data-realm={realm}>
              {scene ?? (
                <div className="scene-placeholder">
                  The world view will appear when a frame arrives.
                </div>
              )}
              {location && (
                <div className="scene-location-label">
                  <span>Current location</span>
                  <strong>{location.name}</strong>
                </div>
              )}
              <div className="scene-scale" aria-hidden="true">
                <span />
                World map · {location?.edges.length ?? 0}{" "}
                {location?.edges.length === 1 ? "path" : "paths"}
              </div>
            </div>
            <div className="location-strip">
              <span className="location-pin" aria-hidden="true">
                ⌖
              </span>
              <div className="location-name">
                <small>Location</small>
                <strong>{location?.name ?? "No location in view"}</strong>
              </div>
              <span className="strip-divider" />
              <div className="population-count">
                <small>Present</small>
                <strong>{location?.actors.length ?? 0} actors</strong>
              </div>
              <div className="population-count">
                <small>Buildings</small>
                <strong>{location?.buildings.length ?? 0}</strong>
              </div>
            </div>
          </section>

          <aside className="detail-rail" aria-label="Observed details">
            <section className="detail-section">
              <p className="eyebrow">At this location</p>
              <h2>People & places</h2>
              {location?.actors.length ? (
                location.actors.map((actor) => (
                  <article
                    className={`entity-row${actor.alive ? "" : " entity-dead"}`}
                    key={actor.id}
                  >
                    <div className="entity-heading">
                      <span className="entity-mark" />{" "}
                      <strong>{title(actor.id)}</strong>
                      {!actor.alive && <span className="dead-label">Dead</span>}
                    </div>
                    <p>{inventoryText(actor)}</p>
                  </article>
                ))
              ) : (
                <p className="empty-note">No actors here.</p>
              )}
              {location?.buildings.map((building) => (
                <article
                  className={`entity-row building-row status-${building.status}`}
                  key={building.id}
                >
                  <div className="entity-heading">
                    <span className="building-mark" />{" "}
                    <strong>{building.name}</strong>
                    <span className="building-status">
                      {title(building.status)}
                    </span>
                  </div>
                  <p>
                    {building.status === "burning" && building.fire
                      ? `Fire ${building.fire.intensity}${building.fire.destroyAt ? ` / ${building.fire.destroyAt}` : ""} · ${building.fire.ticksBurning} ticks`
                      : building.status === "repairing" && building.repair
                        ? `Repair ${building.repair.progress}${building.repair.required ? ` / ${building.repair.required}` : ""}`
                        : inventoryText(building)}
                  </p>
                </article>
              ))}
            </section>
            <section className="detail-section event-section">
              <p className="eyebrow">Committed events</p>
              <h2>Recent activity</h2>
              {recentEvents.length ? (
                <ol className="event-list">
                  {[...recentEvents]
                    .slice(-5)
                    .reverse()
                    .map((event) => (
                      <li key={event.id}>
                        <span
                          className={`event-mark event-${String(event.kind)
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")}`}
                          aria-hidden="true"
                        />
                        <div>
                          <strong>{title(String(event.kind))}</strong>
                          <small>
                            Tick {event.tick}
                            {event.subjects.length > 0 &&
                              ` · ${event.subjects.join(", ")}`}
                          </small>
                        </div>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="empty-note">No recent events.</p>
              )}
            </section>
            {receiptErrors.length > 0 && (
              <p className="receipt-note" role="status">
                Receipt unavailable: {receiptErrors[receiptErrors.length - 1]}
              </p>
            )}
            {artProblems.length > 0 && (
              <p className="receipt-note" role="status">
                Canon art unavailable: {artProblems[artProblems.length - 1]}
              </p>
            )}
            <div className="detail-foot">
              <span>Event {view?.sequence ?? "—"}</span>
              <span>Local inspection</span>
            </div>
          </aside>
        </div>
      )}
      {!settingsOpen && (
        <footer className="bottomline">
          <span>Committed world state</span>
          <span>No world controls in this view</span>
        </footer>
      )}
    </main>
  );
}
