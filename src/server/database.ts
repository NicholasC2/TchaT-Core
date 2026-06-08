import libsql from "@libsql/sqlite3";

export enum ChatType {
    DM = 0,
    GROUP = 1
}

export enum InviteStatus {
    PENDING = 0,
    ACCEPTED = 1,
    DECLINED = 2
}

export class Profile {
    displayName: string = "";
    profileImageURL: string = "";
    bio: string = "";

    constructor(displayName: string, profileImageURL: string, bio: string) {
        this.displayName = displayName;
        this.profileImageURL = profileImageURL;
        this.bio = bio;
    }
}

export class Session {
    session_id: string;
    username: string;

    constructor(session_id: string, username: string) {
        this.session_id = session_id;
        this.username = username;
    }
}

export class User {
    profileInfo: Profile;
    username: string = "";
    publicKey: string = "";
    sessions: Session[] = [];

    constructor(profileInfo: Profile, username: string, publicKey: string, sessions: Session[] = []) {
        this.profileInfo = profileInfo;
        this.username = username;
        this.publicKey = publicKey;
        this.sessions = sessions;
    }

    /**
     * Converts a base User instance into a GroupChatUser instance.
     */
    toGroupChatUser(admin: boolean = false): GroupChatUser {
        return new GroupChatUser(
            this.profileInfo,
            this.username,
            this.publicKey,
            this.sessions,
            admin
        );
    }
}

export class MessageKey {
    key: string;
    user: User;

    constructor(key: string, user: User) {
        this.key = key;
        this.user = user;
    }
}

export class Message {
    id: string;
    author: User;
    encrypted_data: string;
    created_at: number;
    message_keys: MessageKey[];

    constructor(id: string, author: User, encrypted_data: string, created_at: number, message_keys: MessageKey[]) {
        this.id = id;
        this.author = author;
        this.encrypted_data = encrypted_data;
        this.created_at = created_at;
        this.message_keys = message_keys;
    }
}

export class GroupChatUser extends User {
    admin: boolean = false;

    constructor(profileInfo: Profile, username: string, publicKey: string, sessions: Session[] = [], admin: boolean = false) {
        super(profileInfo, username, publicKey, sessions);
        this.admin = admin;
    }

    /**
     * Converts a GroupChatUser instance back into a clean base User instance.
     */
    toUser(): User {
        return new User(
            this.profileInfo,
            this.username,
            this.publicKey,
            this.sessions
        );
    }
}

export abstract class Chat {
    id: string;
    type: ChatType;
    created_at: number;

    constructor(id: string, type: ChatType, created_at: number) {
        this.id = id;
        this.type = type;
        this.created_at = created_at;
    }
}

export class DMChat extends Chat {
    userOne: User;
    userTwo: User;

    constructor(id: string, created_at: number, userOne: User, userTwo: User) {
        super(id, ChatType.DM, created_at);
        this.userOne = userOne;
        this.userTwo = userTwo;
    }
}

export class GroupChat extends Chat {
    name: string;
    users: GroupChatUser[];

    constructor(id: string, name: string, created_at: number, users: GroupChatUser[]) {
        super(id, ChatType.GROUP, created_at);
        this.name = name;
        this.users = users;
    }
}

// --- NEW SYSTEM CLASSES ---

export class Invite {
    id: string;
    chatId: string;
    receiverUsername: string;
    senderUsername: string;
    status: InviteStatus;
    createdAt: number;

    constructor(id: string, chatId: string, receiverUsername: string, senderUsername: string, status: InviteStatus, createdAt: number) {
        this.id = id;
        this.chatId = chatId;
        this.receiverUsername = receiverUsername;
        this.senderUsername = senderUsername;
        this.status = status;
        this.createdAt = createdAt;
    }
}

export class Database {
    db: libsql.Database;

    private saveUserStmt!: libsql.Statement;
    private getUserStmt!: libsql.Statement;
    private deleteUserStmt!: libsql.Statement;
    
    private saveGroupChatStmt!: libsql.Statement;
    private insertGroupParticipantStmt!: libsql.Statement;
    private getGroupChatStmt!: libsql.Statement;
    private getGroupChatUsersStmt!: libsql.Statement;
    
    private saveDMStmt!: libsql.Statement;
    private getDMStmt!: libsql.Statement;
    
    private getGroupChatsForUserStmt!: libsql.Statement;
    private getDMsForUserStmt!: libsql.Statement;
    
    private saveMessageStmt!: libsql.Statement;
    private saveMessageKeyStmt!: libsql.Statement;
    private getMessageStmt!: libsql.Statement;
    private getMessageKeysStmt!: libsql.Statement;
    private getChatMessagesStmt!: libsql.Statement;
    private deleteMessageStmt!: libsql.Statement;
    
    private saveSessionStmt!: libsql.Statement;
    private getSessionsForUserStmt!: libsql.Statement;
    private getSessionByIDStmt!: libsql.Statement;
    private deleteSessionStmt!: libsql.Statement;

    // New Prepared Statements
    private saveInviteStmt!: libsql.Statement;
    private getInviteStmt!: libsql.Statement;
    private getInvitesForUserStmt!: libsql.Statement;
    private updateInviteStatusStmt!: libsql.Statement;
    private deleteInviteStmt!: libsql.Statement;

    private saveSettingStmt!: libsql.Statement;
    private getSettingStmt!: libsql.Statement;
    private getAllSettingsStmt!: libsql.Statement;
    private deleteSettingStmt!: libsql.Statement;

    constructor(url: string) {
        this.db = new libsql.Database(url);
        this.db.exec("PRAGMA foreign_keys = ON;");

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                public_key TEXT NOT NULL,
                display_name TEXT,
                profile_image_url TEXT,
                bio TEXT
            );

            CREATE TABLE IF NOT EXISTS group_chats (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS group_chat_participants (
                group_chat_id TEXT NOT NULL,
                username TEXT NOT NULL,
                admin BOOLEAN NOT NULL DEFAULT 0,
                PRIMARY KEY(group_chat_id, username),
                FOREIGN KEY(group_chat_id) REFERENCES group_chats(id) ON DELETE CASCADE,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS dms (
                id TEXT PRIMARY KEY,
                user_one TEXT NOT NULL,
                user_two TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(user_one, user_two),
                FOREIGN KEY(user_one) REFERENCES users(username) ON DELETE CASCADE,
                FOREIGN KEY(user_two) REFERENCES users(username) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                author TEXT NOT NULL,
                encrypted_data TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(author) REFERENCES users(username) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS message_keys (
                message_id TEXT NOT NULL,
                username TEXT NOT NULL,
                encrypted_key TEXT NOT NULL,
                PRIMARY KEY(message_id, username),
                FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );

            /* --- NEW TABLES --- */
            CREATE TABLE IF NOT EXISTS chat_invites (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                receiver_username TEXT NOT NULL,
                sender_username TEXT NOT NULL,
                status INTEGER NOT NULL DEFAULT 0, -- 0: Pending, 1: Accepted, 2: Declined
                created_at INTEGER NOT NULL,
                FOREIGN KEY(receiver_username) REFERENCES users(username) ON DELETE CASCADE,
                FOREIGN KEY(sender_username) REFERENCES users(username) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_settings (
                username TEXT NOT NULL,
                setting_key TEXT NOT NULL,
                setting_value TEXT NOT NULL, -- Stored as dynamic strings or JSON strings
                PRIMARY KEY(username, setting_key),
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );
        `);

        this.prepareStatements();
    }

    private prepareStatements() {
        this.saveUserStmt = this.db.prepare(`
            INSERT INTO users (username, public_key, display_name, profile_image_url, bio)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                display_name = excluded.display_name,
                profile_image_url = excluded.profile_image_url,
                bio = excluded.bio
        `);
        this.getUserStmt = this.db.prepare("SELECT * FROM users WHERE username = ?");
        this.deleteUserStmt = this.db.prepare("DELETE FROM users WHERE username = ?");
        
        // Group Chats
        this.saveGroupChatStmt = this.db.prepare(`
            INSERT INTO group_chats (id, name, created_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name
        `);
        this.insertGroupParticipantStmt = this.db.prepare(`
            INSERT INTO group_chat_participants (group_chat_id, username, admin) VALUES (?, ?, ?)
            ON CONFLICT(group_chat_id, username) DO UPDATE SET admin = excluded.admin
        `);
        this.getGroupChatStmt = this.db.prepare("SELECT * FROM group_chats WHERE id = ?");
        this.getGroupChatUsersStmt = this.db.prepare(`
            SELECT u.*, gcp.admin FROM users u
            JOIN group_chat_participants gcp ON u.username = gcp.username
            WHERE gcp.group_chat_id = ?
        `);

        // DMs
        this.saveDMStmt = this.db.prepare(`
            INSERT INTO dms (id, user_one, user_two, created_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `);
        this.getDMStmt = this.db.prepare("SELECT * FROM dms WHERE id = ?");

        // Feeds
        this.getGroupChatsForUserStmt = this.db.prepare(`
            SELECT gc.* FROM group_chats gc
            JOIN group_chat_participants gcp ON gc.id = gcp.group_chat_id
            WHERE gcp.username = ? ORDER BY gc.created_at DESC
        `);
        this.getDMsForUserStmt = this.db.prepare(`
            SELECT * FROM dms WHERE user_one = ? OR user_two = ? ORDER BY created_at DESC
        `);

        // Messages
        this.saveMessageStmt = this.db.prepare(`
            INSERT INTO messages (id, chat_id, author, encrypted_data, created_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET encrypted_data = excluded.encrypted_data
        `);
        this.saveMessageKeyStmt = this.db.prepare(`
            INSERT INTO message_keys (message_id, username, encrypted_key) VALUES (?, ?, ?)
            ON CONFLICT(message_id, username) DO UPDATE SET encrypted_key = excluded.encrypted_key
        `);
        this.getMessageStmt = this.db.prepare("SELECT * FROM messages WHERE id = ?");
        
        this.getMessageKeysStmt = this.db.prepare(`
            SELECT mk.encrypted_key, u.* FROM message_keys mk
            JOIN users u ON mk.username = u.username
            WHERE mk.message_id = ?
        `);
        this.getChatMessagesStmt = this.db.prepare(`
            SELECT m.id AS message_id, m.encrypted_data, m.created_at, u.username, u.display_name, u.profile_image_url, u.bio, u.public_key
            FROM messages m
            JOIN users u ON m.author = u.username
            WHERE m.chat_id = ? ORDER BY m.created_at ASC
        `);
        this.deleteMessageStmt = this.db.prepare("DELETE FROM messages WHERE id = ?");

        // Sessions
        this.saveSessionStmt = this.db.prepare(`
            INSERT INTO sessions (session_id, username) VALUES (?, ?)
            ON CONFLICT(session_id) DO UPDATE SET username = excluded.username
        `);
        this.getSessionsForUserStmt = this.db.prepare("SELECT * FROM sessions WHERE username = ?");
        this.getSessionByIDStmt = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?");
        this.deleteSessionStmt = this.db.prepare("DELETE FROM sessions WHERE session_id = ?");

        /* --- NEW PREPARED STATEMENTS --- */
        // Invites
        this.saveInviteStmt = this.db.prepare(`
            INSERT INTO chat_invites (id, chat_id, receiver_username, sender_username, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET status = excluded.status
        `);
        this.getInviteStmt = this.db.prepare("SELECT * FROM chat_invites WHERE id = ?");
        this.getInvitesForUserStmt = this.db.prepare("SELECT * FROM chat_invites WHERE receiver_username = ? ORDER BY created_at DESC");
        this.updateInviteStatusStmt = this.db.prepare("UPDATE chat_invites SET status = ? WHERE id = ?");
        this.deleteInviteStmt = this.db.prepare("DELETE FROM chat_invites WHERE id = ?");

        // Dynamic Settings
        this.saveSettingStmt = this.db.prepare(`
            INSERT INTO user_settings (username, setting_key, setting_value)
            VALUES (?, ?, ?)
            ON CONFLICT(username, setting_key) DO UPDATE SET setting_value = excluded.setting_value
        `);
        this.getSettingStmt = this.db.prepare("SELECT setting_value FROM user_settings WHERE username = ? AND setting_key = ?");
        this.getAllSettingsStmt = this.db.prepare("SELECT setting_key, setting_value FROM user_settings WHERE username = ?");
        this.deleteSettingStmt = this.db.prepare("DELETE FROM user_settings WHERE username = ? AND setting_key = ?");
    }

    /* --- Session Handling --- */
    saveSession(session: Session) { this.saveSessionStmt.run(session.session_id, session.username); }
    getSessionsByUsername(username: string): Session[] {
        const rows = this.getSessionsForUserStmt.all(username) as unknown as any[];
        return rows.map(r => new Session(r.session_id, r.username));
    }
    getSessionsByID(id: string): Session | null {
        const r = this.getSessionByIDStmt.get(id) as any;
        return r ? new Session(r.session_id, r.username) : null;
    }
    deleteSession(sessionId: string) { this.deleteSessionStmt.run(sessionId); }

    /* --- User Handling --- */
    saveUser(user: User) {
        this.saveUserStmt.run(user.username, user.publicKey, user.profileInfo.displayName, user.profileInfo.profileImageURL, user.profileInfo.bio);
        if (user.sessions) user.sessions.forEach(s => this.saveSession(s));
    }
    getUser(username: string): User | null {
        const r = this.getUserStmt.get(username) as any;
        if (!r) return null;
        return new User(new Profile(r.display_name || "", r.profile_image_url || "", r.bio || ""), r.username, r.public_key, this.getSessionsByUsername(username));
    }
    deleteUser(username: string) { this.deleteUserStmt.run(username); }

    /* --- Group Chat Handling --- */
    saveGroupChat(chat: GroupChat) {
        this.saveGroupChatStmt.run(chat.id, chat.name, chat.created_at);
        for (const user of chat.users) {
            this.saveUser(user);
            this.insertGroupParticipantStmt.run(chat.id, user.username, user.admin ? 1 : 0);
        }
    }

    getGroupChat(chatId: string): GroupChat | null {
        const r = this.getGroupChatStmt.get(chatId) as any;
        if (!r) return null;
        const uRows = this.getGroupChatUsersStmt.all(chatId) as unknown as any[];
        const users = uRows.map(u => new GroupChatUser(new Profile(u.display_name || "", u.profile_image_url || "", u.bio || ""), u.username, u.public_key, [], u.admin === 1));
        return new GroupChat(r.id, r.name, r.created_at, users);
    }

    /* --- DM Handling --- */
    getOrCreateDM(myUsername: string, theirUsername: string): string {
        const usersSorted = [myUsername, theirUsername].sort();
        const chatId = `dm_${usersSorted[0]}_${usersSorted[1]}`;
        this.saveDMStmt.run(chatId, usersSorted[0], usersSorted[1], Date.now());
        return chatId;
    }

    getDM(chatId: string): DMChat | null {
        const r = this.getDMStmt.get(chatId) as any;
        if (!r) return null;
        
        const u1 = this.getUser(r.user_one);
        const u2 = this.getUser(r.user_two);
        if (!u1 || !u2) return null;

        return new DMChat(r.id, r.created_at, u1, u2);
    }

    /* --- Combined Feeds Hook --- */
    getAllChatsByUsername(username: string): Chat[] {
        const chats: Chat[] = [];
        
        // Fetch groups
        const groupRows = this.getGroupChatsForUserStmt.all(username) as unknown as any[];
        groupRows.forEach(g => {
            const uRows = this.getGroupChatUsersStmt.all(g.id) as unknown as any[];
            const users = uRows.map(u => new GroupChatUser(new Profile(u.display_name || "", u.profile_image_url || "", u.bio || ""), u.username, u.public_key, u.username === username ? this.getSessionsByUsername(u.username) : [], u.admin === 1));
            chats.push(new GroupChat(g.id, g.name, g.created_at, users));
        });

        // Fetch DMs
        const dmRows = this.getDMsForUserStmt.all(username, username) as unknown as any[];
        dmRows.forEach(d => {
            const u1 = this.getUser(d.user_one);
            const u2 = this.getUser(d.user_two);
            if (u1 && u2) {
                if (u1.username === username) u1.sessions = this.getSessionsByUsername(username);
                if (u2.username === username) u2.sessions = this.getSessionsByUsername(username);
                chats.push(new DMChat(d.id, d.created_at, u1, u2));
            }
        });

        return chats.sort((a, b) => b.created_at - a.created_at);
    }

    deleteChat(chatId: string) {
        if (chatId.startsWith("dm_")) {
            this.db.prepare("DELETE FROM dms WHERE id = ?").run(chatId);
        } else {
            this.db.prepare("DELETE FROM group_chats WHERE id = ?").run(chatId);
        }
    }

    /* --- Message Handling --- */
    saveMessage(chatId: string, message: Message) {
        this.saveMessageStmt.run(message.id, chatId, message.author.username, message.encrypted_data, message.created_at);
        for (const msgKey of message.message_keys) {
            this.saveUser(msgKey.user);
            this.saveMessageKeyStmt.run(message.id, msgKey.user.username, msgKey.key);
        }
    }

    getMessage(messageId: string): Message | null {
        const m = this.getMessageStmt.get(messageId) as any;
        if (!m) return null;
        
        const a = this.getUser(m.author);
        if (!a) return null;

        const kRows = this.getMessageKeysStmt.all(messageId) as unknown as any[];
        const messageKeys = kRows.map(k => new MessageKey(k.encrypted_key, new User(new Profile(k.display_name || "", k.profile_image_url || "", k.bio || ""), k.username, k.public_key, [])));
        return new Message(m.id, a, m.encrypted_data, m.created_at, messageKeys);
    }

    getChatMessages(chatId: string): Message[] {
        const rows = this.getChatMessagesStmt.all(chatId) as unknown as any[];
        return rows.map(row => {
            const author = new User(new Profile(row.display_name || "", row.profile_image_url || "", row.bio || ""), row.username, row.public_key, []);
            const kRows = this.getMessageKeysStmt.all(row.message_id) as unknown as any[];
            const messageKeys = kRows.map(k => new MessageKey(k.encrypted_key, new User(new Profile(k.display_name || "", k.profile_image_url || "", k.bio || ""), k.username, k.public_key, [])));
            return new Message(row.message_id, author, row.encrypted_data, row.created_at, messageKeys);
        });
    }

    deleteMessage(messageId: string) { this.deleteMessageStmt.run(messageId); }

    /* --- NEW: Invite Handling --- */
    saveInvite(invite: Invite) {
        this.saveInviteStmt.run(invite.id, invite.chatId, invite.receiverUsername, invite.senderUsername, invite.status, invite.createdAt);
    }

    getInvite(inviteId: string): Invite | null {
        const r = this.getInviteStmt.get(inviteId) as any;
        if (!r) return null;
        return new Invite(r.id, r.chat_id, r.receiver_username, r.sender_username, r.status, r.created_at);
    }

    getInvitesForUser(username: string): Invite[] {
        const rows = this.getInvitesForUserStmt.all(username) as unknown as any[];
        return rows.map(r => new Invite(r.id, r.chat_id, r.receiver_username, r.sender_username, r.status, r.created_at));
    }

    updateInviteStatus(inviteId: string, status: InviteStatus) {
        this.updateInviteStatusStmt.run(status, inviteId);
    }

    deleteInvite(inviteId: string) {
        this.deleteInviteStmt.run(inviteId);
    }

    /* --- NEW: Dynamic User Settings Handling --- */
    
    /**
     * Store any value securely. Converts objects/arrays/booleans/numbers cleanly into JSON strings.
     */
    setSetting(username: string, key: string, value: any) {
        const valueToString = typeof value === "object" ? JSON.stringify(value) : String(value);
        this.saveSettingStmt.run(username, key, valueToString);
    }

    /**
     * Retrieve settings dynamically. Automatically attempts to safely parse JSON strings back into structures.
     */
    getSetting<T = any>(username: string, key: string): T | null {
        const r = this.getSettingStmt.get(username, key) as any;
        if (!r) return null;
        try {
            return JSON.parse(r.setting_value) as T;
        } catch {
            return r.setting_value as unknown as T; // Return fallback scalar string
        }
    }

    /**
     * Get all custom settings for a user converted into a dynamic JS object mapping
     */
    getAllSettings(username: string): Record<string, any> {
        const rows = this.getAllSettingsStmt.all(username) as unknown as any[];
        const settingsMap: Record<string, any> = {};
        rows.forEach(r => {
            try {
                settingsMap[r.setting_key] = JSON.parse(r.setting_value);
            } catch {
                settingsMap[r.setting_key] = r.setting_value;
            }
        });
        return settingsMap;
    }

    deleteSetting(username: string, key: string) {
        this.deleteSettingStmt.run(username, key);
    }
}