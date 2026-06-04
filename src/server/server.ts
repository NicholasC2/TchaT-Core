import libsql from "@libsql/sqlite3";
import { Config, defaultConfig } from "./config";
import { User, Profile } from "./user.js";
import WebSocket, { WebSocketServer } from "ws";
import { MessageType } from "../core/events.js";

export class Server {
    db: libsql.Database;
    wss: WebSocketServer;

    sendMessage(client: WebSocket, type: MessageType = MessageType.NONE, data: Object = {}) {
        client.send(JSON.stringify({
            t: type,
            d: data
        }))
    }

    constructor(config: Config = defaultConfig) {
        this.db = this.setupDB();

        this.wss = this.setupWSS(config);
    }

    setupWSS(config: Config = defaultConfig): WebSocketServer {
        const server = new WebSocketServer({
            port: config.getPort()
        })

        server.on("listening", ()=>{
            console.log(`Server running at ws://localhost:${config.getPort()}`)
        })

        server.on("connection", (socket, req)=>{
            const timestamp = Date.now();

            let heartbeatTime = timestamp

            socket.on("message", (rawMessage)=>{
                const parsed = JSON.parse(rawMessage.toString());

                const type = parsed.t;
                const data = parsed.d;

                if (typeof type !== "number") throw new Error();
                
                heartbeatTime = timestamp

                switch(type) {
                    case 0: {
                        break;
                    }

                    case 1: {
                        const { username, publicKey, profileInfo } = data;
                        const { displayName, profileImageURL, bio } = profileInfo

                        const newUser = new User(new Profile(displayName, profileImageURL, bio), username, publicKey);

                        
                    }
                }
            })

            const interval = setInterval(() => {
                if (heartbeatTime + 30000 < Date.now()) { 
                    socket.close(1001);
                }
            }, 5000);

            socket.on("close", ()=>{
                clearInterval(interval);
            })
        })

        return server;
    }

    setupDB(): libsql.Database {
        const db = new libsql.Database("file:tchat.db");

        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                public_key TEXT NOT NULL,
                display_name TEXT,
                profile_image_url TEXT,
                bio TEXT
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author TEXT NOT NULL,
                encrypted_content TEXT NOT NULL,
                created_at INTEGER NOT NULL,

                FOREIGN KEY(author) REFERENCES users(username)
            );

            CREATE TABLE IF NOT EXISTS message_keys (
                message_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                encrypted_key TEXT NOT NULL,

                PRIMARY KEY(message_id, username),

                FOREIGN KEY(message_id) REFERENCES messages(id),
                FOREIGN KEY(username) REFERENCES users(username)
            );
        `);

        return db;
    }
}