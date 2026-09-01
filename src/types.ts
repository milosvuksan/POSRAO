export type ResourceId = 'billiards' | 'table-tennis';

export interface PublicEntry {
  entryId: string;
  displayName: string;
  durationMinutes: number;
  position?: number;
  estimatedStartAt?: number;
  startedAt?: number;
  endsAt?: number;
}

export interface ResourceState {
  id: ResourceId;
  label: string;
  active: PublicEntry | null;
  queue: PublicEntry[];
}

export interface PublicState {
  serverTime: number;
  resources: ResourceState[];
}

export interface Control {
  entryId: string;
  token: string;
}

export interface MutationResult {
  entryId?: string;
  token?: string;
  state?: 'queued' | 'active';
  stateSnapshot: PublicState;
  serverTime: number;
}
