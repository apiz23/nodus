import type { ChangeInput, ChangeRecord, DocumentKind, MutationResult, PullResponse, VaultIdentity } from '../sync/contracts.js';

export const PROTOCOL_VERSION = 1;

export interface PairRequest {
  pairingCode: string;
  deviceName: string;
}

export interface PairResponse {
  deviceId: string;
  /** Shown once. The client must store it securely. */
  token: string;
}

export interface RevokeRequest {
  deviceId: string;
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt?: string;
}

export interface PushRequest {
  operationId: string;
  deviceSeq: number;
  changes: ChangeInput[];
}

export interface PushResponse {
  deviceSeq: number;
  results: MutationResult[];
}

export interface PullRequest {
  cursor?: string;
  limit?: number;
}

export interface OperationsRequest {
  fromDeviceSeq: number;
  toDeviceSeq?: number;
}

export interface DeviceSequenceState {
  deviceId: string;
  lastSeq: number;
  oldestOperationSeq: number | null;
}

export interface VaultInfoResponse extends VaultIdentity {
  protocolVersion: number;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface ChangeFeedEntry {
  kind: DocumentKind;
  id: string;
  vaultSeq: number;
  op: ChangeRecord['op'];
  version: number;
  path: string;
  contentHash: string;
  timestamp: string;
}
