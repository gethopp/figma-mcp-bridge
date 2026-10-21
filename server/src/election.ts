import type { Node } from "./node.js";
import { Role } from "./types.js";

/**
 * Election handles leader detection and role transitions.
 *
 * On start it becomes a follower if a healthy leader already answers.
 * Otherwise it attempts to become leader (by binding the port).
 * If the port is taken and a healthy leader is found, it becomes a follower.
 * A periodic ticker monitors the leader and triggers takeover if it dies.
 */
export class Election {
  private interval: ReturnType<typeof setInterval> | null = null;
  private leaderUrl: string;

  constructor(
    private port: number,
    private node: Node
  ) {
    this.leaderUrl = `http://localhost:${port}`;
  }

  async start(): Promise<void> {
    // Determine initial role
    await this.determineRole();

    // Continuous monitoring with random jitter (3-5 s)
    const jitter = 3_000 + Math.random() * 2_000;
    this.interval = setInterval(() => {
      this.checkAndUpdateRole().catch((err) => {
        console.error("Election check error:", err);
      });
    }, jitter);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkAndUpdateRole(): Promise<void> {
    switch (this.node.role) {
      case Role.Follower: {
        const alive = await this.pingLeader();
        if (!alive) {
          console.error("Leader not responding, attempting takeover...");
          try {
            await this.node.becomeLeader();
          } catch (err) {
            console.error("Failed to become leader:", err);
          }
        }
        break;
      }
      case Role.Leader:
        // Nothing to do — we are the leader
        break;
      case Role.Unknown:
        await this.determineRole();
        break;
    }
  }

  private async determineRole(): Promise<void> {
    // Ping before binding: on macOS a leader bound to a different address
    // (e.g. an older version on all interfaces) does not make our bind fail.
    if (await this.pingLeader()) {
      this.node.becomeFollower();
      return;
    }

    try {
      await this.node.becomeLeader();
      return;
    } catch {
      // Port likely in use — check if there's a valid leader
    }

    if (await this.pingLeader()) {
      this.node.becomeFollower();
    }
    // If ping fails too, next tick will retry
  }

  private async pingLeader(): Promise<boolean> {
    try {
      const response = await fetch(`${this.leaderUrl}/ping`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
