import { Chat, Database, DMChat, GroupChat, GroupChatUser, Invite, InviteStatus, Message, MessageKey, Profile, Session, User } from "./database";
import { ErrorTypeToClient } from "../core/errors";
import { MessageTypeToClient, MessageTypeToServer } from "../core/events";

import * as crypto from "crypto";
import WebSocket from "ws";

type WithSession = { sessionID: string };
type WithChatID = { chatID: string };
type WithUsername = { username: string };
type WithMessageID = { messageID: string };
type WithMessageAuthor = { author: string };
type ChallengeIntent = { intent: "LOGIN" | "DELETE_ACCOUNT" };
type WithInviteID = { inviteID: string };
type WithCreatedAt = { createdAt: number };

type GroupChatEdit = {
    name: string;
    users: GroupChatUser[];
}

type MessageEdit = {
    encryptedData: string;
    keys: MessageKey[];
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
    type: MessageTypeToServer.GROUP_CHAT_CREATE,
    data: GroupChatEdit & WithSession & WithCreatedAt
} | {
    type: MessageTypeToServer.GROUP_CHAT_EDIT,
    data: GroupChatEdit & WithChatID & WithSession
} | {
    type: MessageTypeToServer.DM_CREATE | MessageTypeToServer.USER_GET_INFO,
    data: WithUsername & WithSession
} | {
    type: MessageTypeToServer.MESSAGE_CREATE,
    data: MessageEdit & WithSession & WithChatID & WithCreatedAt
} | {
    type: MessageTypeToServer.MESSAGE_DELETE | MessageTypeToServer.MESSAGE_GET,
    data: WithMessageID & WithSession & WithChatID
} | {
    type: MessageTypeToServer.MESSAGE_EDIT,
    data: MessageEdit & WithMessageID & WithSession & WithChatID
} | {
    type: MessageTypeToServer.PARTICIPANT_INVITE,
    data: WithUsername & WithChatID & WithSession
} | {
    type: MessageTypeToServer.PARTICIPANT_UNINVITE | MessageTypeToServer.INVITE_DECLINE | MessageTypeToServer.INVITE_ACCEPT | MessageTypeToServer.INVITE_GET,
    data: WithInviteID & WithSession
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
    data: (GroupChatEdit | WithChatID) & WithCreatedAt
} | {
    type: MessageTypeToClient.CHAT_DELETED,
    data: WithChatID
} | {
    type: MessageTypeToClient.GROUP_CHAT_EDITED,
    data: GroupChatEdit & WithChatID
} | {
    type: MessageTypeToClient.MESSAGE_CREATED,
    data: MessageEdit & WithMessageAuthor & WithChatID & WithCreatedAt
} | {
    type: MessageTypeToClient.MESSAGE_DELETED,
    data: WithMessageID
} | {
    type: MessageTypeToClient.MESSAGE_EDITED,
    data: MessageEdit & WithMessageID
} | {
    type: (MessageTypeToClient.PARTICIPANT_INVITED | MessageTypeToClient.PARTICIPANT_INVITE_ACCEPTED | MessageTypeToClient.PARTICIPANT_INVITE_DECLINED | MessageTypeToClient.PARTICIPANT_UNINVITED),
    data: WithInviteID
}

interface ActiveChallenge {
    challenge: string;
    intent: string;
    createdAt: number;
}

const socketOwnerMap = new WeakMap<WebSocket, string>();
const activeConnections = new Map<string, WebSocket[]>();
const challengeMap = new Map<string, ActiveChallenge>();

setInterval(() => {
    const now = Date.now();
    challengeMap.forEach((challenge, username) => {
        if (now > challenge.createdAt + 30000) {
            challengeMap.delete(username);
        }
    });
}, 10000);

export function handleNewConnection(socket: WebSocket, db: Database) {
    let heartbeatTime = Date.now();

    const interval = setInterval(() => {
        if (heartbeatTime + 30000 < Date.now()) { 
            socket.close(1001);
        }
    }, 5000);
    
    function deleteActiveConnection() {
        const boundUser = socketOwnerMap.get(socket);
        if (boundUser) {
            const sockets = activeConnections.get(boundUser);
            if (sockets) {
                const index = sockets.indexOf(socket);
                if (index !== -1) {
                    sockets.splice(index, 1);
                    if (sockets.length === 0) activeConnections.delete(boundUser);
                }
            }
        }
        for (const [username, sockets] of activeConnections.entries()) {
            const index = sockets.indexOf(socket);
            if (index !== -1) {
                sockets.splice(index, 1);
                if (sockets.length === 0) activeConnections.delete(username);
            }
        }
    }

    socket.on("message", (rawData: string) => {
        heartbeatTime = Date.now();

        try {
            const msg: MessageToServer = JSON.parse(rawData);
            const response = serverHandleMessage(socket, db, msg);
            if (response) {
                socket.send(JSON.stringify(response));
            }
        } catch (err) {
            socket.send(JSON.stringify({ 
                type: MessageTypeToClient.ERROR, 
                data: "INVALID_JSON_PAYLOAD" 
            }));
        }
    });

    socket.on("close", () => {
        deleteActiveConnection();
        clearInterval(interval);
    });

    socket.on("error", (error) => {
        console.error("Socket error encountered:", error);
        deleteActiveConnection();
        clearInterval(interval);
        socket.terminate();
    });
}

export function serverHandleMessage(socket: WebSocket, db: Database, msg: MessageToServer): MessageToClient | undefined {

    function createErrorMessage(type: ErrorTypeToClient): MessageToClient {
        return { type: MessageTypeToClient.ERROR, data: type };
    }

    let session: Session | null = null;
    let user: User | null = null;

    if (msg.data && "sessionID" in msg.data) {
        session = db.getSessionsByID(msg.data.sessionID);

        if (!session) {
            return createErrorMessage(ErrorTypeToClient.SESSION_INVALID);
        }

        user = db.getUser(session.username);

        if (!user) {
            return createErrorMessage(ErrorTypeToClient.ACCOUNT_DELETED);
        }

        const existingBoundUser = socketOwnerMap.get(socket);
        if (existingBoundUser && existingBoundUser !== user.username) {
            return createErrorMessage(ErrorTypeToClient.SESSION_INVALID);
        }

        if (!existingBoundUser) {
            socketOwnerMap.set(socket, user.username);
        }

        const sockets = activeConnections.get(user.username) || [];
        if (!sockets.includes(socket)) {
            sockets.push(socket);
            activeConnections.set(user.username, sockets);
        }
    }

    function safeReplacer(key: string, value: any) {
        if (key === 'sessions') return undefined;
        return value;
    }

    function broadcastToIdentifiers(db: Database, targetUsernames: string[], message: MessageToClient, excludeSocket?: WebSocket) {
        const parsedMessage = JSON.stringify(message, safeReplacer);

        for (const username of targetUsernames) {
            const sockets = activeConnections.get(username);
            if (!sockets) continue;

            for (const s of sockets) {
                if (s === excludeSocket) continue;
                if (s && s.readyState === WebSocket.OPEN) {
                    s.send(parsedMessage);
                }
            }
        }
    }

    function createSession(username: string): Session {
        let id = crypto.randomUUID();
        while (db.getSessionsByID(id) !== null) {
            id = crypto.randomUUID();
        }
        const newSession = new Session(id, username);
        db.saveSession(newSession);
        return newSession;
    }

    function isUserAdmin(chat: Chat, userInstance: User): boolean {
        if (chat instanceof DMChat) return true;
        if (chat instanceof GroupChat) {
            const participant = chat.users.find(u => u.username === userInstance.username);
            return participant?.admin ?? false;
        }
        return false;
    }

    function userToParticipant(chat: GroupChat, userInstance: User): GroupChatUser | null {
        return chat.users.find(u => u.username === userInstance.username) ?? null;
    }

    function isUserInChat(chat: Chat, userInstance: User): boolean {
        if (chat instanceof DMChat) {
            return chat.userOne.username === userInstance.username || chat.userTwo.username === userInstance.username;
        }
        if (chat instanceof GroupChat) {
            return chat.users.some(u => u.username === userInstance.username);
        }
        return false;
    }

    function sanitizeUserForClient(u: any): any {
        if (!u) return null;
        const { sessions, ...stripped } = u;
        return stripped;
    }

    switch (msg.type) {
        case MessageTypeToServer.NONE:
            break;

        case MessageTypeToServer.ACCOUNT_CREATE: {
            const { username, publicKey, profileInfo } = msg.data;

            if (db.getUser(username)) { 
                return createErrorMessage(ErrorTypeToClient.USER_EXISTS);
            }

            const newUser = new User(
                new Profile(profileInfo.displayName, profileInfo.profileImageURL, profileInfo.bio), 
                username, 
                publicKey
            );
            db.saveUser(newUser);

            socketOwnerMap.set(socket, newUser.username);
            const sockets = activeConnections.get(newUser.username) || [];
            if (!sockets.includes(socket)) {
                sockets.push(socket);
                activeConnections.set(newUser.username, sockets);
            }

            return { type: MessageTypeToClient.SUCCESS, data: createSession(newUser.username) };
        }

        case MessageTypeToServer.ACCOUNT_GET_INVITES: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            return { type: MessageTypeToClient.SUCCESS, data: db.getInvitesForUser(user.username) };
        }
        
        case MessageTypeToServer.ACCOUNT_GET_CHATS: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            
            const rawChats = db.getAllChatsByUsername(user.username);
            const sanitizedChats = rawChats.map(chat => {
                if (chat instanceof GroupChat) {
                    return {
                        ...chat,
                        users: chat.users.map(u => ({ ...u, sessions: [] }))
                    };
                } else if (chat instanceof DMChat) {
                    return {
                        ...chat,
                        userOne: sanitizeUserForClient(chat.userOne),
                        userTwo: sanitizeUserForClient(chat.userTwo)
                    };
                }
                return chat;
            });

            return { type: MessageTypeToClient.SUCCESS, data: sanitizedChats };
        }

        case MessageTypeToServer.ACCOUNT_GET_SETTINGS: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            return { type: MessageTypeToClient.SUCCESS, data: db.getAllSettings(user.username) };
        }

        case MessageTypeToServer.ACCOUNT_SET_SETTING: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { key, value } = msg.data;
            db.setSetting(user.username, key, value);
            return { type: MessageTypeToClient.SUCCESS };
        }

        case MessageTypeToServer.CHALLENGE_REQUEST: {
            const { username, intent } = msg.data;
            
            if (!db.getUser(username)) { 
                return createErrorMessage(ErrorTypeToClient.USER_DOESNT_EXIST);
            }

            const challenge = crypto.randomBytes(32).toString('hex');
            const createdAt = Date.now();

            challengeMap.set(username, { challenge, intent, createdAt });

            return { type: MessageTypeToClient.CHALLENGE_ISSUED, data: { challenge, intent, createdAt } };
        }

        case MessageTypeToServer.CHALLENGE_VERIFY_AND_EXECUTE: {
            const { username, signatureHex } = msg.data;
            
            const activeChallenge = challengeMap.get(username);
            const targetUser = db.getUser(username);

            if (!activeChallenge || !targetUser) {
                return createErrorMessage(ErrorTypeToClient.CHALLENGE_EXPIRED);
            }

            challengeMap.delete(username);

            let isVerified = false;
            try {
                const verifier = crypto.createVerify('SHA256');
                verifier.update(`${activeChallenge.intent}:${activeChallenge.challenge}`);
                verifier.end();
                
                isVerified = verifier.verify(
                    { key: targetUser.publicKey, format: 'pem' }, 
                    signatureHex, 
                    'hex'
                );
            } catch (err) {
                isVerified = false;
            }

            if (!isVerified) {
                return createErrorMessage(ErrorTypeToClient.CHALLENGE_FAILED);
            }

            if (activeChallenge.intent === "LOGIN") {
                socketOwnerMap.set(socket, username);
                const sockets = activeConnections.get(username) || [];
                if (!sockets.includes(socket)) {
                    sockets.push(socket);
                    activeConnections.set(username, sockets);
                }
                const newSession = createSession(username);
                return { type: MessageTypeToClient.SUCCESS, data: newSession };
            } else if (activeChallenge.intent === "DELETE_ACCOUNT") {
                db.deleteUser(username);
                return { type: MessageTypeToClient.SUCCESS };
            }

            break;
        }

        case MessageTypeToServer.GROUP_CHAT_CREATE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { name, users } = msg.data;

            const parsedUsers = users
                .map(u => db.getUser(u.username))
                .filter((u): u is User => u !== null);

            let id = crypto.randomUUID();
            while (db.getChat(id) !== null) {
                id = crypto.randomUUID();
            }

            const chat = new GroupChat(
                id, 
                name, 
                Date.now(),
                [user.toGroupChatUser(true), ...parsedUsers.map(u => u.toGroupChatUser(false))]
            );

            db.saveGroupChat(chat);

            const broadcastTargets = chat.users.map(u => u.username);

            broadcastToIdentifiers(db, broadcastTargets, { 
                type: MessageTypeToClient.CHAT_CREATED, 
                data: { name: chat.name, users: chat.users, chatID: chat.id, createdAt: chat.createdAt } 
            });

            return { type: MessageTypeToClient.SUCCESS };
        }

        case MessageTypeToServer.CHAT_DELETE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);

            if (isUserAdmin(chat, user)) {
                db.deleteChat(chatID);

                const broadcastTargets = chat instanceof DMChat 
                    ? [chat.userOne.username, chat.userTwo.username] 
                    : chat.users.map(u => u.username);

                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.CHAT_DELETED, data: { chatID: chat.id } });

                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_MISSING_PERMISSION);
            }
        }

        case MessageTypeToServer.GROUP_CHAT_EDIT: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { name, chatID, users } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (chat instanceof DMChat) return createErrorMessage(ErrorTypeToClient.CHAT_IS_DM);

            const participant = userToParticipant(chat, user);
            if (!participant) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);
            if (!participant.admin) return createErrorMessage(ErrorTypeToClient.USER_MISSING_PERMISSION);

            if (name) {
                chat.name = name;
            }

            if (users) {
                chat.users = users
                    .map(u => db.getUser(u.username))
                    .filter((u): u is User => u !== null)
                    .map(u => u.toGroupChatUser(chat.users.find(p => p.username === u.username)?.admin ?? false));
            }

            db.saveGroupChat(chat);

            const broadcastTargets = chat.users.map(u => u.username);

            broadcastToIdentifiers(db, broadcastTargets, { 
                type: MessageTypeToClient.GROUP_CHAT_EDITED, 
                data: { chatID: chat.id, name: chat.name, users: chat.users } 
            });

            return { type: MessageTypeToClient.SUCCESS };
        }

        case MessageTypeToServer.CHAT_GET: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (!isUserInChat(chat, user)) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);
            
            if (chat instanceof GroupChat) {
                return {
                    type: MessageTypeToClient.SUCCESS,
                    data: {
                        ...chat,
                        users: chat.users.map(u => ({ ...u, sessions: [] }))
                    }
                };
            } else if (chat instanceof DMChat) {
                return {
                    type: MessageTypeToClient.SUCCESS,
                    data: {
                        ...chat,
                        userOne: sanitizeUserForClient(chat.userOne),
                        userTwo: sanitizeUserForClient(chat.userTwo)
                    }
                };
            }
            break;
        }

        case MessageTypeToServer.CHAT_GET_MESSAGES: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (!isUserInChat(chat, user)) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);

            const messages = db.getChatMessages(chatID).map(m => ({
                ...m,
                author: sanitizeUserForClient(m.author),
                keys: m.keys.map(k => ({ ...k, user: sanitizeUserForClient(k.user) }))
            }));
            
            return { type: MessageTypeToClient.SUCCESS, data: messages };
        }

        case MessageTypeToServer.CHAT_GET_PARTICIPANTS_KEYS: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (!isUserInChat(chat, user)) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);

            if (chat instanceof DMChat) {
                return { type: MessageTypeToClient.SUCCESS, data: [chat.userOne.publicKey, chat.userTwo.publicKey] };
            } else if (chat instanceof GroupChat) {
                return { type: MessageTypeToClient.SUCCESS, data: chat.users.map(u => u.publicKey) };
            }
            break;
        }

        case MessageTypeToServer.DM_CREATE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { username } = msg.data;

            const userTwo = db.getUser(username);
            if (!userTwo) return createErrorMessage(ErrorTypeToClient.USER_DOESNT_EXIST);

            const dmExists = db.getAllChatsByUsername(user.username)
                .filter(d => d instanceof DMChat)
                .find(dm =>
                    (dm.userOne.username === user.username && dm.userTwo.username === userTwo.username) ||
                    (dm.userOne.username === userTwo.username && dm.userTwo.username === user.username)
                );

            if (dmExists) return createErrorMessage(ErrorTypeToClient.DM_EXISTS);

            let id = crypto.randomUUID();
            while (db.getChat(id) !== null) {
                id = crypto.randomUUID();
            }

            const dm = new DMChat(id, Date.now(), user, userTwo);
            db.saveDM(dm);

            broadcastToIdentifiers(db, [dm.userTwo.username], { 
                type: MessageTypeToClient.CHAT_CREATED, 
                data: { chatID: dm.id, createdAt: dm.createdAt } 
            });

            return { type: MessageTypeToClient.SUCCESS };
        }

        case MessageTypeToServer.INVITE_ACCEPT: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { inviteID } = msg.data;

            const invite = db.getInvite(inviteID);
            if (!invite) return createErrorMessage(ErrorTypeToClient.INVITE_DOESNT_EXIST);

            if (invite.receiverUsername === user.username) {
                const chat = db.getChat(invite.chatId);
                if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
                if (chat instanceof DMChat) return createErrorMessage(ErrorTypeToClient.CHAT_IS_DM);

                chat.users.push(user.toGroupChatUser(false));
                invite.status = InviteStatus.ACCEPTED;

                db.saveGroupChat(chat);
                db.saveInvite(invite);

                const broadcastTargets = chat.users.map(u => u.username);

                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.PARTICIPANT_INVITE_ACCEPTED, data: { inviteID: invite.id } });
                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.GROUP_CHAT_EDITED, data: { users: chat.users, chatID: chat.id, name: chat.name } });

                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_ISNT_RECEIVING_INVITE);
            }
        }

        case MessageTypeToServer.INVITE_DECLINE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { inviteID } = msg.data;

            const invite = db.getInvite(inviteID);
            if (!invite) return createErrorMessage(ErrorTypeToClient.INVITE_DOESNT_EXIST);

            if (invite.receiverUsername === user.username) {
                const chat = db.getChat(invite.chatId);
                if (!chat || chat instanceof DMChat) {
                    db.deleteInvite(inviteID);
                    return createErrorMessage(ErrorTypeToClient.INTERNAL_ERROR);
                }

                invite.status = InviteStatus.DECLINED;
                db.saveInvite(invite);

                const broadcastTargets = chat.users.map(u => u.username);
                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.PARTICIPANT_INVITE_DECLINED, data: { inviteID: invite.id } });
                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_ISNT_RECEIVING_INVITE);
            }
        }

        case MessageTypeToServer.INVITE_GET: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { inviteID } = msg.data;

            const invite = db.getInvite(inviteID);
            if (!invite) return createErrorMessage(ErrorTypeToClient.INVITE_DOESNT_EXIST);

            if (invite.receiverUsername === user.username) {
                return { type: MessageTypeToClient.SUCCESS, data: invite };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_ISNT_RECEIVING_INVITE);
            }
        }

        case MessageTypeToServer.MESSAGE_CREATE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { encryptedData, keys, chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);

            if (isUserInChat(chat, user)) {
                let id = crypto.randomUUID();
                while (db.getMessage(id) !== null) {
                    id = crypto.randomUUID();
                }

                const message = new Message(id, user, encryptedData, Date.now(), keys);
                db.saveMessage(chatID, message);

                const messagePayload = { 
                    chatID: chat.id, 
                    author: message.author.username, 
                    encryptedData: message.encryptedData, 
                    keys: message.keys, 
                    createdAt: message.createdAt 
                };

                const broadcastTargets = chat instanceof DMChat 
                    ? [chat.userOne.username, chat.userTwo.username] 
                    : chat.users.map(u => u.username);

                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.MESSAGE_CREATED, data: messagePayload });

                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);
            }
        }

        case MessageTypeToServer.MESSAGE_DELETE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { messageID, chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);

            const chatMessages = db.getChatMessages(chatID);
            const message = chatMessages.find(m => m.id === messageID);
            if (!message) return createErrorMessage(ErrorTypeToClient.MESSAGE_DOESNT_EXIST);

            if (message.author.username === user.username || isUserAdmin(chat, user)) {
                db.deleteMessage(messageID);

                const broadcastTargets = chat instanceof DMChat 
                    ? [chat.userOne.username, chat.userTwo.username] 
                    : chat.users.map(u => u.username);

                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.MESSAGE_DELETED, data: { messageID: message.id } });

                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_MISSING_PERMISSION);
            }
        }

        case MessageTypeToServer.MESSAGE_EDIT: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { messageID, chatID, encryptedData, keys } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);

            const chatMessages = db.getChatMessages(chatID);
            const message = chatMessages.find(m => m.id === messageID);
            if (!message) return createErrorMessage(ErrorTypeToClient.MESSAGE_DOESNT_EXIST);

            if (message.author.username === user.username) {
                if (encryptedData) message.encryptedData = encryptedData;
                if (keys) message.keys = keys;

                db.saveMessage(chatID, message);

                const editPayload = { messageID: message.id, encryptedData: message.encryptedData, keys: message.keys };

                const broadcastTargets = chat instanceof DMChat 
                    ? [chat.userOne.username, chat.userTwo.username] 
                    : chat.users.map(u => u.username);

                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.MESSAGE_EDITED, data: editPayload });

                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_MISSING_PERMISSION);
            }
        }

        case MessageTypeToServer.MESSAGE_GET: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { messageID, chatID } = msg.data;

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (!isUserInChat(chat, user)) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);

            const chatMessages = db.getChatMessages(chatID);
            const message = chatMessages.find(m => m.id === messageID);
            if (!message) return createErrorMessage(ErrorTypeToClient.MESSAGE_DOESNT_EXIST);

            return { 
                type: MessageTypeToClient.SUCCESS, 
                data: {
                    ...message,
                    author: sanitizeUserForClient(message.author),
                    keys: message.keys.map(k => ({ ...k, user: sanitizeUserForClient(k.user) }))
                }
            };
        }

        case MessageTypeToServer.PARTICIPANT_INVITE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { chatID, username } = msg.data;

            if (!db.getUser(username)) return createErrorMessage(ErrorTypeToClient.USER_DOESNT_EXIST);

            const chat = db.getChat(chatID);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (!isUserInChat(chat, user)) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);

            let id = crypto.randomUUID();
            while (db.getInvite(id) !== null) {
                id = crypto.randomUUID();
            }

            const invite = new Invite(id, chat.id, username, user.username, InviteStatus.PENDING, Date.now());
            db.saveInvite(invite);

            const broadcastTargets = chat instanceof DMChat 
                ? [chat.userOne.username, chat.userTwo.username] 
                : chat.users.map(u => u.username);

            broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.PARTICIPANT_INVITED, data: { inviteID: invite.id } });

            return { type: MessageTypeToClient.SUCCESS };
        }

        case MessageTypeToServer.PARTICIPANT_UNINVITE: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { inviteID } = msg.data;

            const invite = db.getInvite(inviteID);
            if (!invite) return createErrorMessage(ErrorTypeToClient.INVITE_DOESNT_EXIST);

            const chat = db.getChat(invite.chatId);
            if (!chat) return createErrorMessage(ErrorTypeToClient.CHAT_DOESNT_EXIST);
            if (chat instanceof DMChat) return createErrorMessage(ErrorTypeToClient.CHAT_IS_DM);
            if (!isUserInChat(chat, user)) return createErrorMessage(ErrorTypeToClient.CHAT_NOT_PARTICIPANT);

            if (invite.senderUsername === user.username || isUserAdmin(chat, user)) {
                db.deleteInvite(invite.id);
                const broadcastTargets = chat.users.map(u => u.username);
                broadcastToIdentifiers(db, broadcastTargets, { type: MessageTypeToClient.PARTICIPANT_UNINVITED, data: { inviteID: invite.id } });
                return { type: MessageTypeToClient.SUCCESS };
            } else {
                return createErrorMessage(ErrorTypeToClient.USER_MISSING_PERMISSION);
            }
        }

        case MessageTypeToServer.USER_GET_INFO: {
            if (!user) return createErrorMessage(ErrorTypeToClient.MISSING_SESSION_ID);
            const { username } = msg.data;

            const targetUser = db.getUser(username);
            if (!targetUser) return createErrorMessage(ErrorTypeToClient.USER_DOESNT_EXIST);

            return { type: MessageTypeToClient.SUCCESS, data: sanitizeUserForClient(targetUser) };
        }
    }

    return createErrorMessage(ErrorTypeToClient.TYPE_NOT_IMPLEMENTED);
}