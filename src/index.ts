import 'dotenv/config';
import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import type { ClientToServerEvents, codeRequest, InterServerEvents, ServerToClientEvents, SocketData } from './lib/types.js';
import { redisClient, subscriber } from './config/redis.js';
import { EventStream } from './stream/redis.js';

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

app.get('/health', (req, res) => {
    res.send("Codesaga Socket Server Healthy");
})

async function main() {
    try {
        await redisClient.connect();
        await subscriber.connect();

        const stream = new EventStream({
            redisClient: redisClient,
            streamKey: "codesaga:events:code",
            maxlenApprox: 10_000,
            claimMinIdleMs: 15_000
        });

        setInterval(() => { redisClient.ping().catch(console.error) }, 60000);
        setInterval(() => { subscriber.ping().catch(console.error) }, 60000);

        await subscriber.subscribe('worker_result', async(message) => {
            try {
                const data = JSON.parse(message);
                const socketId: string = data.socketId as string;
                io.to(socketId).emit('codeResponse', data);
            } catch (error) {
                console.error('Error parsing worker message : ', error);
            }
        })

        io.on('connection', (socket) => {
            console.log(`User Connected : ${socket.id}`);

            socket.on('codeRequestQueue', async (req: codeRequest) => {
                console.log(`Data received now pushing to stream`);
                await stream.produce("code:request", req);
            })

            socket.on('disconnect', () => {
                console.log(`User Disconnected : ${socket.id}`);
            })
            
        })

    } catch (error) {
        console.error('Socket Server Error : ', error);
    }
}

main();

server.listen(process.env.PORT, () => console.log(`Websocket Server is running on port ${process.env.PORT}`))