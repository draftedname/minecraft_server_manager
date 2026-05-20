declare module "nat-api" {
  interface NatAPIOptions {
    ttl?: number;
    description?: string;
    gateway?: string;
  }

  class NatAPI {
    constructor(opts?: NatAPIOptions);
    map(
      publicPort: number,
      protocol: "tcp" | "udp",
      callback: (err: Error | null) => void
    ): void;
    map(
      publicPort: number,
      privatePort: number,
      protocol: "tcp" | "udp",
      callback: (err: Error | null) => void
    ): void;
    unmap(
      publicPort: number,
      protocol: "tcp" | "udp",
      callback: (err?: Error) => void
    ): void;
    externalIp(callback: (err: Error | null, ip: string) => void): void;
    destroy(): void;
    close(): void;
  }

  export default NatAPI;
}
