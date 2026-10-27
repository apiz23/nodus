/** A response may update UI state only while it is the newest request. */
export function isBackupRequestCurrent(request: number, currentRequest: number): boolean {
  return request === currentRequest;
}
