import { Config, defaultConfig } from "./config";
import WebSocket, { WebSocketServer } from "ws";
import { MessageType } from "../core/events.js";
import { Chat, ChatType, Database, Profile, Session, User } from "./database.js";
import * as crypto from "crypto"

interface ActiveChallenge {
    challenge: string;
    intent: "LOGIN" | "DELETE_ACCOUNT";
}

export class Server {
    wss: WebSocketServer;
    db: Database;

    challengeMap = new Map<string, ActiveChallenge>();

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

                    switch (type) {
                        case MessageType.NONE:
                            break;

                        case MessageType.ACCOUNT_CREATE: {
                            const { username, publicKey, profileInfo } = data;
                            const { displayName, profileImageURL, bio } = profileInfo;

                            if (this.db.getUser(username)) {
                                sendMessage(MessageType.ERROR, { message: "Username already in use!" });
                                return;
                            }

                            const newUser = new User(new Profile(displayName, profileImageURL, bio), username, publicKey);
                            this.db.saveUser(newUser);
                            sendMessage(MessageType.SUCCESS, { message: "Account created!" });
                            break;
                        }

                        case MessageType.CHALLENGE_REQUEST: {
                            const { username, intent } = data;
                            
                            if (!this.db.getUser(username)) {
                                sendMessage(MessageType.ERROR, { message: "User not found!" });
                                return;
                            }

                            const challenge = crypto.randomBytes(32).toString('hex');
                            this.challengeMap.set(username, { challenge, intent });

                            setTimeout(() => {
                                const current = this.challengeMap.get(username);
                                if (current && current.challenge === challenge) {
                                    this.challengeMap.delete(username);
                                }
                            }, 30000);

                            sendMessage(MessageType.CHALLENGE_ISSUED, { challenge, intent });
                            break;
                        }

                        case MessageType.CHALLENGE_VERIFY_AND_EXECUTE: {
                            const { username, signatureHex } = data;
                            
                            const activeChallenge = this.challengeMap.get(username);
                            const user = this.db.getUser(username);

                            if (!activeChallenge || !user) {
                                sendMessage(MessageType.ERROR, { message: "Challenge expired or invalid setup." });
                                return;
                            }

                            this.challengeMap.delete(username);

                            let isVerified = false;
                            try {
                                const verifier = crypto.createVerify('SHA256');
                                verifier.update(activeChallenge.challenge);
                                verifier.end();
                                
                                isVerified = verifier.verify(
                                    { key: user.publicKey, format: 'pem' }, 
                                    signatureHex, 
                                    'hex'
                                );
                            } catch (err) {
                                isVerified = false;
                            }

                            if (!isVerified) {
                                sendMessage(MessageType.ERROR, { message: "Signature verification failed!" });
                                return;
                            }

                            if (activeChallenge.intent === "LOGIN") {
                                const session = new Session(crypto.randomUUID(), user.username);
                                this.db.saveSession(session);
                                sendMessage(MessageType.SUCCESS, { message: "Logged in successfully!", user, session });
                            } else if (activeChallenge.intent === "DELETE_ACCOUNT") {
                                this.db.deleteUser(username);
                                sendMessage(MessageType.SUCCESS, { message: "Account deleted successfully." });
                            }
                            break;
                        }

                        case MessageType.ACCOUNT_GET_CHATS: {
                            const { sessionID } = data;

                            const session = this.db.getSessionsByID(sessionID);
                            
                            if(!session) {
                                sendMessage(MessageType.ERROR, { message: "Invalid session ID!" })
                                return;
                            }

                            const chats = this.db.getChatsByUsername(session.username);
                            sendMessage(MessageType.SUCCESS, chats)
                            
                            break;
                        }

                        case MessageType.ACCOUNT_GET_SETTINGS: {
                            sendMessage(MessageType.TYPE_NOT_IMPLEMENTED);

                            break;
                        }

                        case MessageType.CHAT_CREATE: {
                            const { sessionID, chatInfo } = data;
                            const { name, type } = chatInfo;

                            const session = this.db.getSessionsByID(sessionID);
                            
                            if(!session) {
                                sendMessage(MessageType.ERROR, { message: "Invalid session ID!" })
                                return;
                            }

                            const user = this.db.getUser(session.username)
                            
                            if(!user) {
                                sendMessage(MessageType.ERROR, { message: "Invalid user!" })
                                return;
                            }

                            // WIP
                        }
                    }
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