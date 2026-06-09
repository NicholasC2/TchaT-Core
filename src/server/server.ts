import { Config, defaultConfig } from "./config";
import { WebSocketServer } from "ws";
import { Database } from "./database.js";
import { handleNewConnection } from "./messageHandler.js";

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

        server.on("connection", (socket, req)=>handleNewConnection(socket, this.db))

        return server;
    }
}