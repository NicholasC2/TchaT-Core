import { Config, defaultConfig } from "./config";
import { WebSocketServer } from "ws";
import { Database } from "./database.js";
import { MessageTypeToClient, MessageTypeToServer } from "../core/events.js";
import { serverHandleMessage } from "./messageHandler.js";
import { ErrorTypeToClient } from "../core/errors.js";

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
            const timestamp = Date.now();

            let heartbeatTime = timestamp

            socket.on("message", (rawMessage) => {
                try {
                    const parsed = JSON.parse(rawMessage.toString());

                    heartbeatTime = Date.now();

                    serverHandleMessage(socket, this.db, parsed)
                } catch (error) {
                    socket.send(JSON.stringify({
                        t: MessageTypeToClient.ERROR, 
                        d: ErrorTypeToClient.INTERNAL_ERROR
                    }));
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