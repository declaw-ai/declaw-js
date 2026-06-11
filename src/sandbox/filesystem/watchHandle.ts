import type { FilesystemEvent } from './models.js';

/**
 * Handle for a filesystem directory watch.
 *
 * Buffers incoming events in memory. Call `getNewEvents()` to drain
 * the buffer, and `stop()` to prevent new events from being added.
 */
export class WatchHandle {
  private events: FilesystemEvent[] = [];
  private stopped = false;

  /**
   * Stop accepting new events.
   * Idempotent — calling multiple times has no additional effect.
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * Drain and return all buffered events since the last call.
   * Returns an empty array if no new events have been received.
   */
  getNewEvents(): FilesystemEvent[] {
    const result = this.events;
    this.events = [];
    return result;
  }

  /**
   * Push a new event into the buffer.
   * Ignored if `stop()` has been called.
   */
  pushEvent(event: FilesystemEvent): void {
    if (!this.stopped) {
      this.events.push(event);
    }
  }
}
