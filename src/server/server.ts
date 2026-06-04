import { Config, defaultConfig } from "./config";
import { User, Profile } from "./user.js";
import WebSocket, { WebSocketServer } from "ws";
import { MessageType } from "../core/events.js";
import { Database } from "./database.js";

export class Server {
    wss: WebSocketServer;
    db: Database;

    sendMessage(client: WebSocket, type: MessageType = MessageType.NONE, data: Object = {}) {
        client.send(JSON.stringify({
            t: type,
            d: data
        }))
    }

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

            socket.on("message", (rawMessage)=>{
                const parsed = JSON.parse(rawMessage.toString());

                const type = parsed.t;
                const data = parsed.d;

                if (typeof type !== "number") throw new Error();
                
                heartbeatTime = timestamp

                switch(type) {
                    case MessageType.NONE: {
                        break;
                    }

                    case MessageType.CREATE_ACCOUNT: {
                        const { username, publicKey, profileInfo } = data;
                        const { displayName, profileImageURL, bio } = profileInfo

                        if(this.db.getUser(username)) {
                            socket.send(JSON.stringify({
                                t: MessageType.ERROR,
                                d: {
                                    message: "Username already in use!"
                                }
                            }))
                            
                            return;
                        }

                        const newUser = new User(new Profile(displayName, profileImageURL, bio), username, publicKey);

                        this.db.saveUser(newUser);
                    }

                    case MessageType.DELETE_ACCOUNT: {
                        const { username, private_key } = data;

                        // verify

                        this.db.deleteUser(username);
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
}