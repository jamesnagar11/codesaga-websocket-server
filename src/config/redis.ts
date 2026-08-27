import dotenv from 'dotenv';
import { createClient } from 'redis';
dotenv.config();

export const redisClient = createClient({
    url: process.env.REDIS_URL!,
    socket: {
        reconnectStrategy: retries => {
            if(retries > 5) return new Error('Too many retries');
            return Math.min(retries * 50, 500);
        }
    }
});

export const subscriber = redisClient.duplicate();

redisClient.on('error', (err) => {
    console.error('Redis Client Error : ', err);
});

redisClient.on('connect', () => console.log('Redis Client connected'));

subscriber.on('error', (err) => {
    console.error('Redis Subscriber Error : ', err);
});

subscriber.on('connect', () => console.log('Redis Subscriber connected'));