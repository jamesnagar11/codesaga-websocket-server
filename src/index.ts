import dotenv from 'dotenv';
import express from 'express';
import type { Request, Response } from 'express';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import type { ClientToServerEvents, codeRequest, InterServerEvents, ServerToClientEvents, SocketData } from './lib/types.js';
import { redisClient, subscriber } from './config/redis.js';
import { EventStream } from './stream/redis.js';
import { randomUUID } from 'node:crypto';
import { client } from './config/prom.js';
import { socketMiddleware } from './middleware.js';
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
dotenv.config();

const RATE_LIMIT_POINTS   = 5;   // max requests per window per user
const RATE_LIMIT_DURATION = 10;  // window in seconds
const RETRY_AFTER_SECONDS = 2;   // communicated back to the client

const app = express();
const server = createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(server, {
    cors: {
        origin: process.env.NEXT_URL!,
        credentials: true,
        methods: ['GET','POST','PUT']
    }
});

io.use(socketMiddleware);

app.get('/health', (req: Request, res: Response) => {
    res.send("Codesaga Socket Server Healthy");
});

app.get('/metrics', async (req, res) => {
    try {
        const metrics = await client.register.metrics();
        res.set('Content-Type', client.register.contentType);
        res.end(metrics);
    } catch (error) {
        console.error('Error rendering metrics:', error);
        res.status(500).send('Internal Server Error');
    }
});

const subscriber_id = randomUUID();

const activeUsersGuage = new client.Gauge({
    name: 'codesaga_ws_active_users',
    help: 'Number of active users',
})

async function main() {
    try {
        await redisClient.connect();
        await subscriber.connect();

        const rateLimiter = new RateLimiterRedis({
            storeClient: redisClient,
            useRedisPackage: true,
            points: RATE_LIMIT_POINTS,
            duration: RATE_LIMIT_DURATION,
            keyPrefix: 'rl:codeRequestQueue',
        })

        const stream = new EventStream({
            redisClient: redisClient,
            streamKey: process.env.STREAM_KEY!,
            maxlenApprox: Number(process.env.MAXLEN_APPROX!),
            claimMinIdleMs: Number(process.env.CLAIM_MIN_IDLE_MS!)
        });

        const dbstream = new EventStream({
            redisClient: redisClient,
            streamKey: process.env.BULK_STREAM_KEY!,
            maxlenApprox: Number(process.env.BULK_MAXLEN_APPROX!),
            claimMinIdleMs: Number(process.env.BULK_CLAIM_MIN_IDLE_MS!)
        });

        setInterval(() => { redisClient.ping().catch(console.error) }, 60000);
        setInterval(() => { subscriber.ping().catch(console.error) }, 60000);

        await subscriber.subscribe(`code:result:${subscriber_id}`, async(message) => {
            try {
                const data = JSON.parse(message);
                const socketId: string = data.socketId as string;
                io.to(socketId).emit('codeResponse', data);
                await dbstream.produce("code:response", data);
            } catch (error) {
                console.error('Error parsing worker message : ', error);
            }
        });

        io.on('connection', (socket) => {
            activeUsersGuage.inc();
            console.log(`User Connected : ${socket.id}`);

            socket.on('codeRequestQueue', async (req: codeRequest) => {
                const rateLimitKey = socket.data.user.id ?? socket.id;

                try {
                    await rateLimiter.consume(rateLimitKey);
                } catch (err) {
                    if (err instanceof RateLimiterRes) {
                        socket.emit('rateLimited', {
                            status:     429,
                            message:    'Too many requests. Please slow down and try again.',
                            retryAfter: RETRY_AFTER_SECONDS,
                        });
                        console.warn(`Rate limited user [${rateLimitKey}] on codeRequestQueue. msBeforeNext=${err.msBeforeNext}`);
                        return;
                    }
                    console.error('Rate limiter unexpected error:', err);
                    return;
                }

                console.log(`Data received now pushing to stream`);
                 await stream.produce("code:request", {...req, subscribedTo: `code:result:${subscriber_id}`});
            });

            socket.on('disconnect', () => {
                activeUsersGuage.dec();
                console.log(`User Disconnected : ${socket.id}`);
            });
            
        });

    } catch (error) {
        console.error('Socket Server Error : ', error);
        if (subscriber.isOpen) {
            try {
                await subscriber.xGroupDelConsumer(process.env.STREAM_KEY!, process.env.CONSUMER_GROUP!, `code:result:${subscriber_id}`);
            } catch (err) {
                console.error('Error deleting consumer: ', err);
            }
        }
    }
}

main();

server.listen(process.env.PORT, () => console.log(`Websocket Server is running on port ${process.env.PORT}`));