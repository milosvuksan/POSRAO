import { DatabaseSync } from 'node:sqlite';
export declare const RESOURCE_IDS: readonly ["billiards", "table-tennis"];
export type ResourceId = (typeof RESOURCE_IDS)[number];
export type EntryState = 'queued' | 'active' | 'completed' | 'cancelled' | 'expired';
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
export declare class AppError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string);
}
export declare class Scheduler {
    private db;
    private now;
    constructor(db: DatabaseSync, now?: () => number);
    private migrate;
    private transaction;
    private getEntry;
    private assertResource;
    private validateInput;
    private assertControl;
    private promote;
    private reconcileInTransaction;
    reconcile(): boolean;
    create(resourceValue: string, input: {
        name?: unknown;
        pin?: unknown;
        durationMinutes?: unknown;
    }): {
        entryId: `${string}-${string}-${string}-${string}-${string}`;
        token: string;
        state: "queued" | "active";
        stateSnapshot: PublicState;
    };
    recover(input: {
        name?: unknown;
        pin?: unknown;
    }): {
        entryId: string;
        token: string;
        state: EntryState;
        stateSnapshot: PublicState;
    };
    extend(id: string, token?: string): {
        stateSnapshot: PublicState;
    };
    finish(id: string, token?: string): {
        stateSnapshot: PublicState;
    };
    cancel(id: string, token?: string): {
        stateSnapshot: PublicState;
    };
    getState(): PublicState;
    private stateInTransaction;
}
