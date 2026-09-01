import type { ExtendedError, Socket } from "socket.io";
import type { SessionToken } from "./lib/types.js";
import jwt from "jsonwebtoken";

export const socketMiddleware = (
    socket: Socket,
    next: (err?: ExtendedError) => void
) => {
    try {
        console.log("authorization started");

        const token = socket.handshake.auth.token;

        if (!token) {
            return next(new Error("Authentication error: Token missing"));
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET!
        ) as SessionToken;

        socket.data.user = decoded;

        console.log("authorized completed");
        next();

    } catch (error) {
        console.log(
            `User with socket.id : ${socket.id} not authorized to connect`
        );

        next(new Error("not authorized"));
    }
};