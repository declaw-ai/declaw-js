/** Type of a filesystem entry. */
export enum FileType {
  File = 'file',
  Dir = 'dir',
}

/** Type of a filesystem event. */
export enum FilesystemEventType {
  Create = 'create',
  Write = 'write',
  Remove = 'remove',
  Rename = 'rename',
  Chmod = 'chmod',
}

/** Information about a filesystem entry. */
export interface EntryInfo {
  name: string;
  path: string;
  type: FileType;
  size: number;
}

/** Parse raw JSON data into EntryInfo. */
export function parseEntryInfo(data: Record<string, any>): EntryInfo {
  return {
    name: data.name ?? '',
    path: data.path ?? '',
    type: (data.type as FileType) ?? FileType.File,
    size: data.size ?? 0,
  };
}

/** Information about a write operation. */
export interface WriteInfo {
  path: string;
  size: number;
}

/** Parse raw JSON data into WriteInfo. */
export function parseWriteInfo(data: Record<string, any>): WriteInfo {
  return {
    path: data.path ?? '',
    size: data.size ?? 0,
  };
}

/** An entry to write to the filesystem. */
export interface WriteEntry {
  path: string;
  data: string | Uint8Array;
}

/** A filesystem event from watching a directory. */
export interface FilesystemEvent {
  type: FilesystemEventType;
  path: string;
  timestamp?: number;
}

/** Parse raw JSON data into a FilesystemEvent. */
export function parseFilesystemEvent(data: Record<string, any>): FilesystemEvent {
  return {
    type: (data.type as FilesystemEventType) ?? FilesystemEventType.Create,
    path: data.path ?? '',
    timestamp: data.timestamp ?? undefined,
  };
}
