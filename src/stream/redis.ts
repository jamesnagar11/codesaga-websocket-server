import type { RedisClientType } from "redis";

export interface EventStreamOptions {
    redisClient?: RedisClientType | undefined;
    streamKey?: string | undefined;
    maxlenApprox?: number | undefined;
    claimMinIdleMs?: number | undefined;
}

export class EventStream {
    redis: RedisClientType | undefined;
    streamKey: string;
    maxlenApprox: number;
    claimMinIdleMs: number;

    _producedTotal: number;
    _ackedTotal: number;
    _claimedTotal: number;

    constructor({
        redisClient,
        streamKey = "codesaga:events:code",
        maxlenApprox = 10_000,
        claimMinIdleMs = 15_000
    }: EventStreamOptions = {}) {

        this.redis = redisClient;
        this.streamKey = streamKey;
        this.maxlenApprox = maxlenApprox;
        this.claimMinIdleMs = claimMinIdleMs;

        this._producedTotal = 0;
        this._ackedTotal = 0;
        this._claimedTotal = 0;
    }

    async produce(eventType: string, payload: Record<string, unknown>): Promise<string> {
        const ids = await this.produceBatch([[eventType, payload]]);
        if (ids.length > 0 && !!ids[0]) {
            return ids[0];
        }
        throw new Error("Failed to produce event");
    }

    async produceBatch(events: Array<[string, Record<string, unknown>]>): Promise<string[]> {
        const list = Array.from(events);
        if (!this.redis) {
            // throw new Error("Redis client is not initialized");
            return [];
        }
        if (list.length === 0) return [];
        const pipe = this.redis.multi();
        for (const [eventType, payload] of list) {
        const fields = EventStream._encodeFields(eventType, payload);
        pipe.xAdd(this.streamKey, "*", fields, {
            TRIM: {
            strategy: "MAXLEN",
            strategyModifier: "~",
            threshold: this.maxlenApprox,
            },
        });
        }
        // execAsPipeline sends the commands in one round trip without
        // wrapping them in MULTI/EXEC.
        const ids = await pipe.execAsPipeline();
        this._producedTotal += ids.length;
        return ids.map((id) => String(id));
    }

    static _encodeFields(eventType: string, payload: Record<string, unknown>): Record<string, string> {
        const fields: Record<string, string> = {
            type: String(eventType),
            ts_ms: String(Date.now()),
        };
        if (payload) {
            for (const [key, value] of Object.entries(payload)) {
                fields[key] = value === null || value === undefined ? "" : String(value);
            }
        }
        return fields;
    }
}