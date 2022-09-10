import Redis from "ioredis";
import { json } from "stream/consumers";
import { MusicPlayerData } from './types/playerdata';

const redis = new Redis({
    port: 6379, // Redis port
    host: "localhost", // Redis host
    password: process.env['password'],
    timeout: 200
});

export default {
    get: async (key) => {
        const data = await redis.get(key);
        return data ? JSON.parse(data) : undefined;
    },
    set: async (key, value) => redis.set(key, JSON.stringify(value)),
    getPlayer: async (key) => {
        return JSON.parse(await redis.get(key)) as MusicPlayerData;
    }
}

// // Reset all players to their correct state.
// redis.keys("", (err, keys) => {
//     keys.forEach(key => {
//         redis.get(key, (err, value) => {
//             let data = JSON.parse(value);
//             if (data.isPlaying)
//                 data.isPlaying = false;
//             redis.set(key, JSON.stringify(data));
//         })
//     });
// })