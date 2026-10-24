/** Global "user is in the middle of an edit" flag, consulted before reloading for an update. */
let busy: () => boolean = () => false;

export function setEditorBusyProbe(fn: () => boolean): void {
  busy = fn;
}

export function isEditorBusy(): boolean {
  return busy();
}
