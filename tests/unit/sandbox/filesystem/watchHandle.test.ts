import { describe, it, expect } from 'vitest';

import { WatchHandle } from '../../../../src/sandbox/filesystem/watchHandle.js';
import { FilesystemEventType } from '../../../../src/sandbox/filesystem/models.js';
import type { FilesystemEvent } from '../../../../src/sandbox/filesystem/models.js';

function makeEvent(type: FilesystemEventType, path: string): FilesystemEvent {
  return { type, path, timestamp: Date.now() };
}

describe('WatchHandle', () => {
  it('getNewEvents() returns empty array initially', () => {
    const handle = new WatchHandle();
    expect(handle.getNewEvents()).toEqual([]);
  });

  it('getNewEvents() returns pushed events', () => {
    const handle = new WatchHandle();
    const evt1 = makeEvent(FilesystemEventType.Create, '/tmp/a.txt');
    const evt2 = makeEvent(FilesystemEventType.Write, '/tmp/b.txt');
    handle.pushEvent(evt1);
    handle.pushEvent(evt2);

    const events = handle.getNewEvents();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(evt1);
    expect(events[1]).toEqual(evt2);
  });

  it('getNewEvents() drains the buffer — second call returns empty', () => {
    const handle = new WatchHandle();
    handle.pushEvent(makeEvent(FilesystemEventType.Remove, '/tmp/c.txt'));

    expect(handle.getNewEvents()).toHaveLength(1);
    expect(handle.getNewEvents()).toEqual([]);
  });

  it('stop() prevents new events from being added', () => {
    const handle = new WatchHandle();
    handle.pushEvent(makeEvent(FilesystemEventType.Create, '/tmp/before.txt'));
    handle.stop();
    handle.pushEvent(makeEvent(FilesystemEventType.Write, '/tmp/after.txt'));

    const events = handle.getNewEvents();
    expect(events).toHaveLength(1);
    expect(events[0].path).toBe('/tmp/before.txt');
  });

  it('stop() is idempotent', () => {
    const handle = new WatchHandle();
    handle.stop();
    handle.stop(); // should not throw

    handle.pushEvent(makeEvent(FilesystemEventType.Create, '/tmp/x.txt'));
    expect(handle.getNewEvents()).toEqual([]);
  });
});
