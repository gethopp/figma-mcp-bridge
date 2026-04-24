import { Leader } from "./leader.js";
import { Follower } from "./follower.js";
import { Role } from "./types.js";
import type { BridgeResponse, ConnectedFile } from "./types.js";

/**
 * Node is the dynamic handler that switches between leader and follower roles.
 * It routes MCP tool calls to the appropriate backend based on its current role.
 */
export class Node {
  private _role: Role = Role.Unknown;
  private leader: Leader | null = null;
  private follower: Follower;

  constructor(private port: number) {
    this.follower = new Follower(`http://localhost:${port}`);
  }

  get role(): Role {
    return this._role;
  }

  get roleName(): string {
    switch (this._role) {
      case Role.Leader:
        return "LEADER";
      case Role.Follower:
        return "FOLLOWER";
      default:
        return "UNKNOWN";
    }
  }

  send(
    requestType: string,
    nodeIds?: string[],
    fileKey?: string
  ): Promise<BridgeResponse> {
    return this.sendWithParams(requestType, nodeIds, undefined, fileKey);
  }

  sendWithParams(
    requestType: string,
    nodeIds?: string[],
    params?: Record<string, unknown>,
    fileKey?: string
  ): Promise<BridgeResponse> {
    if (this._role === Role.Leader && this.leader) {
      return this.leader
        .getBridge()
        .sendWithParams(requestType, nodeIds, params, fileKey);
    }
    return this.follower.sendWithParams(requestType, nodeIds, params, fileKey);
  }

  listConnectedFiles(): ConnectedFile[] | undefined {
    if (this._role === Role.Leader && this.leader) {
      return this.leader.getBridge().listConnectedFiles();
    }
    // Followers return undefined — the tool handler falls back to RPC
    return undefined;
  }

  async becomeLeader(): Promise<void> {
    if (this._role === Role.Leader) return;

    const leader = new Leader(this.port);
    await leader.start();

    this.leader = leader;
    this._role = Role.Leader;
    console.error("Became LEADER");
  }

  becomeFollower(): void {
    if (this._role === Role.Follower) return;

    if (this.leader) {
      this.leader.stop();
      this.leader = null;
    }

    this._role = Role.Follower;
    console.error("Became FOLLOWER");
  }

  stop(): void {
    if (this.leader) {
      this.leader.stop();
      this.leader = null;
    }
    this._role = Role.Unknown;
  }
}
