/** An item to copy into a template. */
export interface CopyItem {
  src: string;
  dst: string;
  mode?: number;
}

/**
 * Fluent builder for template definitions.
 */
export class TemplateBase {
  private _baseImage: string = 'ubuntu:22.04';
  private _runCmds: string[][] = [];
  private _copies: CopyItem[] = [];
  private _envs: Record<string, string> = {};
  private _aptPackages: string[] = [];
  private _startCmd?: string;
  /**
   * When set, the server uses this Dockerfile verbatim and ignores the
   * structured fields. Use for multi-stage builds, ARG, ONBUILD, etc.
   */
  private _dockerfile?: string;

  /** Set the base image for the template. */
  fromBaseImage(image?: string): this {
    this._baseImage = image ?? 'ubuntu:22.04';
    return this;
  }

  /**
   * Use a raw Dockerfile string instead of the structured helpers.
   *
   * When set, all other ``aptInstall`` / ``runCmd`` / ``setEnvs`` /
   * ``copy`` / ``setStartCmd`` / ``fromBaseImage`` calls on this spec
   * are ignored — the Dockerfile is sent to the build worker verbatim.
   *
   * @param content Full Dockerfile contents. Must contain a ``FROM``
   *   instruction. Capped server-side at 64 KiB.
   */
  fromDockerfile(content: string): this {
    this._dockerfile = content;
    return this;
  }

  /** Add a run command (as array of command + args). */
  runCmd(cmds: string[]): this {
    this._runCmds.push(cmds);
    return this;
  }

  /** Add a file copy operation. */
  copy(src: string, dst: string, mode?: number): this {
    this._copies.push({ src, dst, mode });
    return this;
  }

  /** Set environment variables. */
  setEnvs(envs: Record<string, string>): this {
    this._envs = { ...this._envs, ...envs };
    return this;
  }

  /** Install apt packages. */
  aptInstall(...packages: string[]): this {
    this._aptPackages.push(...packages);
    return this;
  }

  /** Set the start command. */
  setStartCmd(cmd: string): this {
    this._startCmd = cmd;
    return this;
  }

  /** Serialize the template to a JSON-friendly object. */
  toJSON(): Record<string, any> {
    // Raw Dockerfile path: send only the dockerfile field; the server
    // ignores helpers when this is set.
    if (this._dockerfile !== undefined) {
      return { dockerfile: this._dockerfile };
    }
    const result: Record<string, any> = {
      base_image: this._baseImage,
    };

    if (this._runCmds.length > 0) {
      // Server expects each run_cmd as a single shell line. Accept both
      // ``runCmd(["pip3 install x"])`` and
      // ``runCmd(["pip3", "install", "x"])`` and space-join so both
      // serialize the same on the wire. (#233)
      result.run_cmds = this._runCmds.map((c) => c.join(' '));
    }

    if (this._copies.length > 0) {
      result.copies = this._copies;
    }

    if (Object.keys(this._envs).length > 0) {
      result.envs = this._envs;
    }

    if (this._aptPackages.length > 0) {
      result.apt_packages = this._aptPackages;
    }

    if (this._startCmd !== undefined) {
      result.start_cmd = this._startCmd;
    }

    return result;
  }
}

/** Information about a template build. */
export interface BuildInfo {
  buildId: string;
  status: string;
  templateId?: string;
}

/** Parse raw JSON data into BuildInfo. */
export function parseBuildInfo(data: Record<string, any>): BuildInfo {
  return {
    buildId: data.build_id ?? data.buildId ?? '',
    status: data.status ?? '',
    templateId: data.template_id ?? data.templateId ?? undefined,
  };
}

/** Status of a template build. */
export interface TemplateBuildStatus {
  buildId: string;
  status: string;
  logs: string[];
}

/** Parse raw JSON data into TemplateBuildStatus. */
export function parseTemplateBuildStatus(data: Record<string, any>): TemplateBuildStatus {
  return {
    buildId: data.build_id ?? data.buildId ?? '',
    status: data.status ?? '',
    logs: data.logs ?? [],
  };
}
