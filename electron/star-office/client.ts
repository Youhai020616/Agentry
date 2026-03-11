/**
 * Star Office UI HTTP Client
 * Typed wrapper around Star Office REST API endpoints
 */
/** Star Office agent state */
export type StarOfficeState = 'idle' | 'writing' | 'researching' | 'executing' | 'syncing' | 'error';

/** Status response from Star Office */
export interface StarOfficeStatus {
  state: StarOfficeState;
  detail?: string;
  progress?: number;
  ttl_seconds?: number;
}

/** Agent info in Star Office */
export interface StarOfficeAgent {
  name: string;
  state: StarOfficeState;
  detail?: string;
  area?: string;
  last_push?: number;
}

/** Default request timeout (3s to avoid blocking main process) */
const DEFAULT_TIMEOUT = 3000;

export class StarOfficeClient {
  private baseUrl: string;

  constructor(port: number = 19000) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  setPort(port: number): void {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  /** Health check */
  async health(): Promise<boolean> {
    try {
      const res = await this.fetch('/health');
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Get main agent status */
  async getStatus(): Promise<StarOfficeStatus | null> {
    try {
      const res = await this.fetch('/status');
      if (!res.ok) return null;
      return (await res.json()) as StarOfficeStatus;
    } catch {
      return null;
    }
  }

  /** Set main agent state */
  async setMainState(state: StarOfficeState, detail?: string): Promise<boolean> {
    try {
      const res = await this.fetch('/set_state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, detail: detail ?? '' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Get all agents */
  async getAgents(): Promise<StarOfficeAgent[]> {
    try {
      const res = await this.fetch('/agents');
      if (!res.ok) return [];
      const data = (await res.json()) as { agents?: StarOfficeAgent[] };
      return data.agents ?? [];
    } catch {
      return [];
    }
  }

  /** Join an agent to the office */
  async joinAgent(joinKey: string, agentName: string): Promise<boolean> {
    try {
      const res = await this.fetch('/join-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinKey, agentName }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Push agent state update */
  async pushAgentState(
    joinKey: string,
    agentName: string,
    state: StarOfficeState,
    detail?: string
  ): Promise<boolean> {
    try {
      const res = await this.fetch('/agent-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinKey, agentName, state, detail: detail ?? '' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Remove an agent from the office */
  async leaveAgent(joinKey: string, agentName: string): Promise<boolean> {
    try {
      const res = await this.fetch('/leave-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinKey, agentName }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Internal fetch with timeout */
  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

