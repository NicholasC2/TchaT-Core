import { ChatType, Database, DMChat, GroupChat, Message, Profile, Session, User } from "./database";
import { ErrorTypeToClient } from "../core/errors";
import { MessageTypeToClient, MessageTypeToServer } from "../core/events";

import * as crypto from "crypto"
import WebSocket from "ws";

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
    type: MessageTypeToServer.CHAT_DELETE | MessageTypeToServer.CHAT_GET | MessageTypeToServer.CHAT_GET_PARTICIPANTS_KEYS | MessageTypeToServer.CHAT_GET_MESSAGES,
    data: WithChatID & WithSession
} | {
    type: MessageTypeToServer.GROUP_CHAT_CREATE | MessageTypeToServer.DM_CREATE,
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
    type: (MessageTypeToClient.PARTICIPANT_INVITED | MessageTypeToClient.PARTICIPANT_INVITE_ACCEPTED | MessageTypeToClient.PARTICIPANT_INVITE_DECLINED | MessageTypeToClient.PARTICIPANT_UNINVITED),
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

export function serverHandleMessage(socket: WebSocket, db: Database, msg: MessageToServer) {

    function sendMessage(msg: MessageToClient) {
        socket.send(JSON.stringify(msg))
        return;
    }

    function sendError(type: ErrorTypeToClient) {
        sendMessage({ type: MessageTypeToClient.ERROR, data: type});
    }

    let session;
    let user;

    if(!!msg.data && "sessionID" in msg.data) {
        session = db.getSessionsByID(msg.data.sessionID);

        if(!session) {
            sendError(ErrorTypeToClient.SESSION_INVALID)
            return;
        }

        user = db.getUser(session.username);

        if(!user) {
            sendError(ErrorTypeToClient.ACCOUNT_DELETED)
            return;
        }
    }

    function createSession(username: string) {
        const session = new Session(crypto.randomUUID(), username);
        db.saveSession(session);

        return session;
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
            sendMessage({ type: MessageTypeToClient.SUCCESS, data: createSession(newUser.username) });
            break;
        }

        case MessageTypeToServer.ACCOUNT_GET_INVITES: {
            if(!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID)
                return;
            }

            sendMessage({ type: MessageTypeToClient.SUCCESS, data: db.getInvitesForUser(user.username) });

            break;
        }
        
        case MessageTypeToServer.ACCOUNT_GET_CHATS: {
            if(!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID)
                return;
            }

            const chats = db.getAllChatsByUsername(user.username);
            sendMessage({ type: MessageTypeToClient.SUCCESS, data: chats })
            
            break;
        }

        case MessageTypeToServer.ACCOUNT_GET_SETTINGS: {
            if(!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const settings = db.getAllSettings(user.username);
            sendMessage({ type: MessageTypeToClient.SUCCESS, data: settings })

            break;
        }

        case MessageTypeToServer.ACCOUNT_SET_SETTING: {
            if(!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID)
                return;
            }

            const { key, value } = msg.data

            db.setSetting(user.username, key, value);

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

        case MessageTypeToServer.GROUP_CHAT_CREATE: {
            if(!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const { name, users } = msg.data;

            const parsedUsers = users
                .map(u => db.getUser(u))
                .filter(user => user != null);

            const chat = new GroupChat(crypto.randomUUID(), name, Date.now(), [user.toGroupChatUser(true), ...parsedUsers.map((u) => u.toGroupChatUser(false))])

            db.saveGroupChat(chat);

            sendMessage({ type: MessageTypeToClient.SUCCESS, data: chat });
            
            break;
        }

        case MessageTypeToServer.CHAT_DELETE: {
            if (!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const { chatID } = msg.data;

            const chat = db.getGroupChat(chatID);
            if (!chat) {

                sendError(ErrorTypeToClient.CHAT_DOESNT_EXIST);
                return;
            }

            const participant = chat.users.find(
                participant => participant.username === user.username
            );

            if (!participant) {
                sendError(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);
                return;
            }

            if (!participant.admin) {
                sendError(ErrorTypeToClient.CHAT_NOT_ADMIN);
                return;
            }

            db.deleteChat(chatID);

            sendMessage({ type: MessageTypeToClient.SUCCESS });

            break;
        }

        case MessageTypeToServer.CHAT_EDIT: {
            if (!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const { name, chatID, users } = msg.data;

            const chat = db.getGroupChat(chatID);
            if (!chat) {
                sendError(ErrorTypeToClient.CHAT_DOESNT_EXIST);
                return;
            }

            if (chat.type !== ChatType.GROUP) {
                sendError(ErrorTypeToClient.CHAT_IS_DM);
                return;
            }

            const participant = chat.users.find(
                u => u.username === user.username
            );

            if (!participant) {
                sendError(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);
                return;
            }

            if (!participant.admin) {
                sendError(ErrorTypeToClient.CHAT_NOT_ADMIN);
                return;
            }

            if (name) {
                chat.name = name;
            }

            if (users.length > 0) {
                chat.users = users
                    .map(username => db.getUser(username))
                    .filter((u): u is User => u != null)
                    .map(u =>
                        u.toGroupChatUser(
                            chat.users.find(
                                p => p.username === u.username
                            )?.admin ?? false
                        )
                    );
            }

            sendMessage({ type: MessageTypeToClient.SUCCESS });

            break;
        }

        case MessageTypeToServer.CHAT_GET: {
            if (!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const { chatID } = msg.data;

            const chat = db.getGroupChat(chatID);
            if (!chat) {
                sendError(ErrorTypeToClient.CHAT_DOESNT_EXIST);
                return;
            }
            
            sendMessage({ type: MessageTypeToClient.SUCCESS, data: chat });

            break;
        }

        case MessageTypeToServer.CHAT_GET_MESSAGES: {
            if (!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const { chatID } = msg.data;

            const chat = db.getGroupChat(chatID);
            if (!chat) {
                sendError(ErrorTypeToClient.CHAT_DOESNT_EXIST);
                return;
            }

            const messages = db.getChatMessages(chatID);
            
            sendMessage({ type: MessageTypeToClient.SUCCESS, data: messages });
            
            break;
        }

        case MessageTypeToServer.CHAT_GET_PARTICIPANTS_KEYS: {
            if (!user) {
                sendError(ErrorTypeToClient.MISSING_SESSION_ID);
                return;
            }

            const { chatID } = msg.data;

            const chat = db.getOrCreateDM(chatID);
            if (!chat) {
                sendError(ErrorTypeToClient.CHAT_DOESNT_EXIST);
                return;
            }

            switch(chat.type) {
                case ChatType.DM: {
                    const user_keys = chat.users[0]

                    sendMessage({ type: MessageTypeToClient.SUCCESS, data: messages });

                    break;
                }

                case ChatType.GROUP: {
                    sendMessage({ type: MessageTypeToClient.SUCCESS, data: messages });

                    break;
                }
            }
            
            break;
        }
    }
}