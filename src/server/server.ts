import { Config, defaultConfig } from "./config";
import WebSocket, { WebSocketServer } from "ws";
import { Chat, ChatType, Database, GroupChat, GroupChatUser, Profile, Session, User } from "./database.js";
import * as crypto from "crypto"

export class Server {
    wss: WebSocketServer;
    db: Database;

    constructor(config: Config = defaultConfig) {
        this.db = new Database(config.getDBURL());
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
            function sendMessage(type: MessageType = MessageType.NONE, data: Object = {}) {
                socket.send(JSON.stringify({ t: type, d: data }));
            }

            const timestamp = Date.now();

            let heartbeatTime = timestamp

            socket.on("message", (rawMessage) => {
                try {
                    const parsed = JSON.parse(rawMessage.toString());
                    const type = parsed.t as MessageType;
                    const data = parsed.d;

                    if (typeof type !== "number") throw new Error("Invalid message type format");
                    heartbeatTime = Date.now();

                    
                } catch (error) {
                    sendMessage(MessageType.ERROR, { message: "Malformed payload or internal processing error." });
                }
            });

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
}