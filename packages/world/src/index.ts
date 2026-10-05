// Rules, actions, time, economy, conflict, and perception.
//
// World core, geography, and the action pipeline: entities and the
// three-realm location graph (state.ts), pure adjacency/realm queries
// (geography.ts), execution-time proposal validation with an extensible
// registry (validate.ts), and the tick scheduler plus event-reducer
// registry persistence replays to rebuild projections (actions.ts).
// packages/world never depends on SQLite or any storage engine;
// everything here is pure functions over plain values.

export * from "./actions";
export * from "./codec";
export * from "./contests";
export * from "./director";
export * from "./economy";
export * from "./fire";
export * from "./geography";
export * from "./goals";
export * from "./journey";
export * from "./memory";
export * from "./needs";
export * from "./perception";
export * from "./petitions";
export * from "./practices";
export * from "./repair";
export * from "./routines";
export * from "./state";
export * from "./validate";
export * from "./worship";
