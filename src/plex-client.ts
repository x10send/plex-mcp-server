export interface PlexClientConfig {
  baseUrl: string;
  token: string;
  clientIdentifier: string;
}

export interface IPlexClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
}

export class PlexApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "PlexApiError";
  }
}

export class PlexClient implements IPlexClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: PlexClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.headers = {
      "X-Plex-Token": config.token,
      "X-Plex-Client-Identifier": config.clientIdentifier,
      "X-Plex-Product": "plex-mcp-server",
      "X-Plex-Version": "0.1.0",
      Accept: "application/json",
    };
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = this.buildUrl(path, params);
    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) throw new PlexApiError(res.status, await this.errorText(res));
    return res.json() as Promise<T>;
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    return url.toString();
  }

  private async errorText(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.slice(0, 200) || res.statusText;
    } catch {
      return res.statusText;
    }
  }
}
