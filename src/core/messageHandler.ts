import { Database, Profile, Session, User } from "../server/database";
import { ErrorTypeToClient } from "./errors";
import { MessageTypeToClient, MessageTypeToServer } from "./events";

import * as crypto from "crypto"

type WithSession = { sessionID: string };

type ChallengeIntent = { intent: "LOGIN" | "DELETE_ACCOUNT" }

type MessageToServer =
  | {
      type: MessageTypeToServer.NONE;
      data?: undefined;
    }
  | {
      type: MessageTypeToServer.ACCOUNT_CREATE;
      data: {
        username: string;
        publicKey: string;
        profileInfo: {
          displayName: string;
          profileImageURL: string;
          bio: string;
        };
      };
    }
  | {
      type: MessageTypeToServer.ACCOUNT_GET_CHATS;
      data: WithSession;
    }
  | {
      type: MessageTypeToServer.ACCOUNT_GET_SETTINGS;
      data: WithSession;
    }
  | {
      type: MessageTypeToServer.CHALLENGE_REQUEST;
      data: { username: string } & WithSession & ChallengeIntent; 
    }
  | {
      type: MessageTypeToServer.CHALLENGE_VERIFY_AND_EXECUTE,
      data: { username: string, signatureHex: string }
    }

type MessageToClient = {
    type: MessageTypeToClient.SUCCESS,
    data?: Object
} | {
    type: MessageTypeToClient.ERROR,
    data: ErrorTypeToClient
} | {
    type: MessageTypeToClient.CHALLENGE_ISSUED,
    data: ActiveChallenge
}

interface ActiveChallenge {
    challenge: string;
    intent: ChallengeIntent | string;
}

const challengeMap = new Map<string, ActiveChallenge>();

function serverHandleMessage(socket: WebSocket, db: Database, msg: MessageToServer) {
    function sendMessage(msg: MessageToClient) {
        socket.send(JSON.stringify(msg))
        return;
    }

    function sendError(type: ErrorTypeToClient) {
        sendMessage({ type: MessageTypeToClient.ERROR, data: type});
    }

    switch (msg.type) {
        case MessageTypeToServer.NONE:
            break;

        case MessageTypeToServer.ACCOUNT_CREATE: {
            const { username, publicKey, profileInfo } = msg.data;

            if(db.getUser(username)) { 
                sendError(ErrorTypeToClient.USER_EXISTS)
                return
            }

            const newUser = new User(
                new Profile(
                    profileInfo.displayName, 
                    profileInfo.profileImageURL, 
                    profileInfo.bio
                ), 
                username, 
                publicKey
            );
            db.saveUser(newUser);
            sendMessage({ type: MessageTypeToClient.SUCCESS });
            break;
        }

        case MessageTypeToServer.CHALLENGE_REQUEST: {
            const { username, intent } = msg.data;
            
            if(!db.getUser(username)) { 
                sendError(ErrorTypeToClient.USER_DOESNT_EXIST)
                return
            }

            const challenge = crypto.randomBytes(32).toString('hex');
            challengeMap.set(username, { challenge, intent });

            setTimeout(() => {
                const current = challengeMap.get(username);
                if (current && current.challenge === challenge) {
                    challengeMap.delete(username);
                }
            }, 30000);

            sendMessage({ type: MessageTypeToClient.CHALLENGE_ISSUED, data: { challenge, intent } });
            break;
        }

        case MessageTypeToServer.CHALLENGE_VERIFY_AND_EXECUTE: {
            const { username, signatureHex } = msg.data;
            
            const activeChallenge = challengeMap.get(username);
            const user = db.getUser(username);

            if (!activeChallenge || !user) {
                sendError(ErrorTypeToClient.CHALLENGE_EXPIRED)
                return;
            }

            challengeMap.delete(username);

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
                sendError(ErrorTypeToClient.CHALLENGE_FAILED);
                return;
            }

            if (activeChallenge.intent === "LOGIN") {
                const session = new Session(crypto.randomUUID(), user.username);
                db.saveSession(session);
                sendMessage({ type: MessageTypeToClient.SUCCESS, data: session });
            } else if (activeChallenge.intent === "DELETE_ACCOUNT") {
                db.deleteUser(username);
                sendMessage({ type: MessageTypeToClient.SUCCESS});
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

            const chats = this.db.getAllChatsByUsername(session.username);
            sendMessage(MessageType.SUCCESS, {chats})
            
            break;
        }

        case MessageType.ACCOUNT_GET_SETTINGS: {
            sendMessage(MessageType.TYPE_NOT_IMPLEMENTED);

            break;
        }

        case MessageType.GROUP_CHAT_CREATE: {
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

            const chat = new GroupChat(crypto.randomUUID(), name, Date.now(), [user.toGroupChatUser(true)])

            this.db.saveGroupChat(chat);

            sendMessage(MessageType.SUCCESS, { chat });
        }

        case MessageType.GROUP_CHAT_DELETE: {
            const { sessionID, chatID } = data;

            const session = this.db.getSessionsByID(sessionID);

            if(!session) {
                sendMessage(MessageType.ERROR, { message: "Invalid session ID!" })
                return;
            }

            const chat = this.db.getChat(chatID);

            chat?.users.find((user) => user.admin)

            const user = this.db.getUser(session.username);

            if(!user) {
                sendMessage(MessageType.ERROR, { message: "Invalid user!" })
                return;
            }

            

            this.db.deleteChat(chatID);
        }
    }
}