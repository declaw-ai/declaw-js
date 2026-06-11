import { describe, it, expect } from 'vitest';
import {
  FileType,
  FilesystemEventType,
  parseEntryInfo,
  parseWriteInfo,
  parseFilesystemEvent,
} from '../../../../src/sandbox/filesystem/models.js';

describe('FileType enum', () => {
  it('has expected values', () => {
    expect(FileType.File).toBe('file');
    expect(FileType.Dir).toBe('dir');
  });
});

describe('FilesystemEventType enum', () => {
  it('has expected values', () => {
    expect(FilesystemEventType.Create).toBe('create');
    expect(FilesystemEventType.Write).toBe('write');
    expect(FilesystemEventType.Remove).toBe('remove');
    expect(FilesystemEventType.Rename).toBe('rename');
    expect(FilesystemEventType.Chmod).toBe('chmod');
  });
});

describe('parseEntryInfo', () => {
  it('parses entry data', () => {
    const entry = parseEntryInfo({
      name: 'file.txt',
      path: '/home/user/file.txt',
      type: 'file',
      size: 1024,
    });
    expect(entry.name).toBe('file.txt');
    expect(entry.path).toBe('/home/user/file.txt');
    expect(entry.type).toBe(FileType.File);
    expect(entry.size).toBe(1024);
  });

  it('parses directory entry', () => {
    const entry = parseEntryInfo({ name: 'src', path: '/src', type: 'dir', size: 0 });
    expect(entry.type).toBe(FileType.Dir);
  });

  it('uses defaults for missing fields', () => {
    const entry = parseEntryInfo({});
    expect(entry.name).toBe('');
    expect(entry.path).toBe('');
    expect(entry.type).toBe(FileType.File);
    expect(entry.size).toBe(0);
  });
});

describe('parseWriteInfo', () => {
  it('parses write info', () => {
    const info = parseWriteInfo({ path: '/tmp/out.txt', size: 512 });
    expect(info.path).toBe('/tmp/out.txt');
    expect(info.size).toBe(512);
  });

  it('uses defaults', () => {
    const info = parseWriteInfo({});
    expect(info.path).toBe('');
    expect(info.size).toBe(0);
  });
});

describe('parseFilesystemEvent', () => {
  it('parses event with timestamp', () => {
    const event = parseFilesystemEvent({
      type: 'write',
      path: '/tmp/log.txt',
      timestamp: 1700000000,
    });
    expect(event.type).toBe(FilesystemEventType.Write);
    expect(event.path).toBe('/tmp/log.txt');
    expect(event.timestamp).toBe(1700000000);
  });

  it('handles missing timestamp', () => {
    const event = parseFilesystemEvent({ type: 'remove', path: '/tmp/old' });
    expect(event.type).toBe(FilesystemEventType.Remove);
    expect(event.timestamp).toBeUndefined();
  });

  it('uses defaults for missing fields', () => {
    const event = parseFilesystemEvent({});
    expect(event.type).toBe(FilesystemEventType.Create);
    expect(event.path).toBe('');
  });
});
