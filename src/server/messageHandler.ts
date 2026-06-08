import { Database, DMChat, GroupChat, Message, Profile, Session, User } from "./database";
import { ErrorTypeToClient } from "../core/errors";
import { MessageTypeToClient, MessageTypeToServer } from "../core/events";

import * as crypto from "crypto"

type WithSession = { sessionID: string };

type WithChatID = { chatID: string }

type WithUsername = { username: string }

type WithMessageID = { messageID: string }

type WithMessageAuthor = { author: string }

type ChallengeIntent = { intent: "LOGIN" | "DELETE_ACCOUNT" }

type WithInviteID = { inviteID: string }

type ChatEdit = {
    name: string;
    users: string[];
}

type MessageEdit = {
    encrypted_data: string;
    message_keys: string[];
}

type MessageToServer = | {
    type: MessageTypeToServer.NONE,
    data?: undefined
} | {
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
} | {
    type: MessageTypeToServer.ACCOUNT_GET_CHATS | MessageTypeToServer.ACCOUNT_GET_SETTINGS | MessageTypeToServer.ACCOUNT_GET_INVITES;
    data: WithSession;
} | {
    type: MessageTypeToServer.ACCOUNT_SET_SETTING;
    data: { key: string; value: any } & WithSession;
} | {
    type: MessageTypeToServer.CHALLENGE_REQUEST;
    data: ChallengeIntent & WithUsername; 
} | {
    type: MessageTypeToServer.CHALLENGE_VERIFY_AND_EXECUTE,
    data: { signatureHex: string } & WithUsername 
} | {
    type: MessageTypeToServer.CHAT_DELETE |
          MessageTypeToServer.CHAT_GET |
          MessageTypeToServer.CHAT_GET_PARTICIPANTS_KEYS |
          MessageTypeToServer.CHAT_GET_MESSAGES,

    data: WithChatID & WithSession
} | {
    type: MessageTypeToServer.CHAT_CREATE,
    data: ChatEdit & WithSession
} | {
    type: MessageTypeToServer.CHAT_EDIT,
    data: ChatEdit & WithChatID & WithSession
} | {
    type: MessageTypeToServer.MESSAGE_CREATE,
    data: MessageEdit & WithSession
} | {
    type: MessageTypeToServer.MESSAGE_DELETE | MessageTypeToServer.MESSAGE_GET,
    data: WithMessageID & WithSession
} | {
    type: MessageTypeToServer.MESSAGE_EDIT,
    data: MessageEdit & WithMessageID & WithSession
} | {
    type: MessageTypeToServer.PARTICIPANT_INVITE | MessageTypeToServer.PARTICIPANT_REMOVE,
    data: {
        user: string;
    } & WithChatID & WithSession
} | {
    type: MessageTypeToServer.PARTICIPANT_UNINVITE | MessageTypeToServer.INVITE_DECLINE | MessageTypeToServer.INVITE_ACCEPT | MessageTypeToServer.INVITE_GET,
    data: WithInviteID & WithSession
} | {
    type: MessageTypeToServer.USER_GET_INFO,
    data: {
        user: string;
    } & WithSession
}

type MessageToClient = | {
    type: MessageTypeToClient.SUCCESS,
    data?: Object
} | {
    type: MessageTypeToClient.ERROR,
    data: ErrorTypeToClient
} | {
    type: MessageTypeToClient.CHALLENGE_ISSUED,
    data: ActiveChallenge
} | {
    type: MessageTypeToClient.CHAT_CREATED,
    data: ChatEdit
} | {
    type: MessageTypeToClient.CHAT_DELETED,
    data: WithChatID
} | {
    type: MessageTypeToClient.CHAT_EDITED,
    data: ChatEdit & WithChatID
} | {
    type: MessageTypeToClient.MESSAGE_CREATED,
    data: MessageEdit & WithMessageAuthor & WithUsername
} | {
    type: MessageTypeToClient.MESSAGE_DELETED,
    data: WithMessageID
} | {
    type: MessageTypeToClient.MESSAGE_EDITED,
    data: MessageEdit & WithMessageID & WithUsername
} | {
    type: MessageTypeToClient.PARTICIPANT_INVITED | MessageTypeToClient.PARTICIPANT_INVITE_ACCEPTED | MessageTypeToClient.PARTICIPANT_INVITE_DECLINED | MessageTypeToClient.PARTICIPANT_UNINVITED,
    data: WithInviteID
} | {
    type: MessageTypeToClient.PARTICIPANT_REMOVED,
    data: WithChatID & WithUsername
} | {
    type: MessageTypeToClient.TYPE_NOT_IMPLEMENTED;
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

    

    if(!!msg.data && "sessionID" in msg.data) {
        
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

        case MessageTypeToServer.ACCOUNT_GET_CHATS: {
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