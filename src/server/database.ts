import libsql from "@libsql/sqlite3";

export enum ChatType {
    DM = 0,
    GROUP = 1
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

export class Chat {
    id: string;
    type: ChatType;
    name: string;
    created_at: number;
    users: User[];

    constructor(id: string, type: ChatType, name: string, created_at: number, users: User[]) {
        this.id = id;
        this.type = type;
        this.name = name;
        this.created_at = created_at;
        this.users = users;
    }
}

export class Database {
    db: libsql.Database;

    private saveUserStmt!: libsql.Statement;
    private getUserStmt!: libsql.Statement;
    private deleteUserStmt!: libsql.Statement;
    private saveChatStmt!: libsql.Statement;
    private insertParticipantStmt!: libsql.Statement;
    private getChatStmt!: libsql.Statement;
    private getChatsForUserStmt!: libsql.Statement;
    private getChatUsersStmt!: libsql.Statement;
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

            CREATE TABLE IF NOT EXISTS chats (
                id TEXT PRIMARY KEY,
                type INTEGER NOT NULL,
                name TEXT,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_participants (
                chat_id TEXT NOT NULL,
                username TEXT NOT NULL,
                PRIMARY KEY(chat_id, username),
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
                FOREIGN KEY(username) REFERENCES users(username) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                chat_id TEXT NOT NULL,
                author TEXT NOT NULL,
                encrypted_data TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE,
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
        
        this.saveChatStmt = this.db.prepare(`
            INSERT OR REPLACE INTO chats (id, type, name, created_at)
            VALUES (?, ?, ?, ?)
        `);
        this.insertParticipantStmt = this.db.prepare(`
            INSERT OR IGNORE INTO chat_participants (chat_id, username)
            VALUES (?, ?)
        `);
        this.getChatStmt = this.db.prepare("SELECT * FROM chats WHERE id = ?");
        this.getChatsForUserStmt = this.db.prepare(`
            SELECT c.* FROM chats c
            JOIN chat_participants cp ON c.id = cp.chat_id
            WHERE cp.username = ?
            ORDER BY c.created_at DESC
        `);
        this.getChatUsersStmt = this.db.prepare(`
            SELECT u.* FROM users u
            JOIN chat_participants cp ON u.username = cp.username
            WHERE cp.chat_id = ?
        `);

        this.saveMessageStmt = this.db.prepare(`
            INSERT OR REPLACE INTO messages (id, chat_id, author, encrypted_data, created_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        this.saveMessageKeyStmt = this.db.prepare(`
            INSERT OR REPLACE INTO message_keys (message_id, username, encrypted_key)
            VALUES (?, ?, ?)
        `);
        this.getMessageStmt = this.db.prepare("SELECT * FROM messages WHERE id = ?");
        
        this.getMessageKeysStmt = this.db.prepare(`
            SELECT mk.encrypted_key, u.*
            FROM message_keys mk
            JOIN users u ON mk.username = u.username
            WHERE mk.message_id = ?
        `);

        this.getChatMessagesStmt = this.db.prepare(`
            SELECT 
                m.id AS message_id, m.encrypted_data, m.created_at,
                u.username, u.display_name, u.profile_image_url, u.bio, u.public_key
            FROM messages m
            JOIN users u ON m.author = u.username
            WHERE m.chat_id = ? 
            ORDER BY m.created_at ASC
        `);
        this.deleteMessageStmt = this.db.prepare("DELETE FROM messages WHERE id = ?");

        this.saveSessionStmt = this.db.prepare(`
            INSERT OR REPLACE INTO sessions (session_id, username) VALUES (?, ?)
        `);
        this.getSessionsForUserStmt = this.db.prepare(`
            SELECT * FROM sessions WHERE username = ?
        `);
        this.getSessionByIDStmt = this.db.prepare(`
            SELECT * FROM sessions WHERE session_id = ?
        `);
        this.deleteSessionStmt = this.db.prepare(`
            DELETE FROM sessions WHERE session_id = ?
        `);
    }

    saveSession(session: Session) {
        this.saveSessionStmt.run(session.session_id, session.username);
    }

    getSessionsByUsername(username: string): Session[] {
        const rows = this.getSessionsForUserStmt.all(username) as unknown as any[];
        return rows.map(row => new Session(row.session_id, row.username));
    }

    getSessionsByID(id: string): Session | null {
        const row = this.getSessionByIDStmt.get(id) as unknown as { session_id: string; username: string } | undefined;
        if (!row) return null;
        return new Session(row.session_id, row.username);
    }

    deleteSession(sessionId: string) {
        this.deleteSessionStmt.run(sessionId);
    }

    saveUser(user: User) {
        this.saveUserStmt.run(
            user.username,
            user.publicKey,
            user.profileInfo.displayName,
            user.profileInfo.profileImageURL,
            user.profileInfo.bio
        );
        if (user.sessions && user.sessions.length > 0) {
            for (const session of user.sessions) {
                this.saveSession(session);
            }
        }
    }

    getUser(username: string): User | null {
        const row = this.getUserStmt.get(username) as any;
        if (!row) return null;

        const sessions = this.getSessionsByUsername(username);

        return new User(
            new Profile(row.display_name || "", row.profile_image_url || "", row.bio || ""),
            row.username,
            row.public_key,
            sessions
        );
    }

    deleteUser(username: string) {
        this.deleteUserStmt.run(username);
    }

    saveChat(chat: Chat) {
        this.saveChatStmt.run(chat.id, chat.type, chat.name || null, chat.created_at);

        for (const user of chat.users) {
            this.saveUser(user);
            this.insertParticipantStmt.run(chat.id, user.username);
        }
    }

    getChat(chatId: string): Chat | null {
        const chatRow = this.getChatStmt.get(chatId) as any;
        if (!chatRow) return null;

        const userRows = this.getChatUsersStmt.all(chatId) as unknown as any[];
        const users = userRows.map(row => {
            return new User(
                new Profile(row.display_name || "", row.profile_image_url || "", row.bio || ""),
                row.username,
                row.public_key,
                []
            );
        });

        return new Chat(
            chatRow.id,
            chatRow.type as ChatType,
            chatRow.name || "",
            chatRow.created_at,
            users
        );
    }

    getChatsByUsername(username: string): Chat[] {
        const chatRows = this.getChatsForUserStmt.all(username) as unknown as any[];
        
        return chatRows.map(chatRow => {
            const userRows = this.getChatUsersStmt.all(chatRow.id) as unknown as any[];
            
            const users = userRows.map(row => {
                const sessions = row.username === username ? this.getSessionsByUsername(row.username) : [];

                return new User(
                    new Profile(row.display_name || "", row.profile_image_url || "", row.bio || ""),
                    row.username,
                    row.public_key,
                    sessions
                );
            });
    
            return new Chat(
                chatRow.id,
                chatRow.type as ChatType,
                chatRow.name || "",
                chatRow.created_at,
                users
            );
        });
    }

    getOrCreateDM(myUsername: string, theirUsername: string): string {
        const chatId = "dm_" + [myUsername, theirUsername].sort().join("_");
        
        const chatStmt = this.db.prepare("INSERT OR IGNORE INTO chats (id, type, name, created_at) VALUES (?, ?, NULL, ?)");
        chatStmt.run(chatId, ChatType.DM, Date.now());

        this.insertParticipantStmt.run(chatId, myUsername);
        this.insertParticipantStmt.run(chatId, theirUsername);

        return chatId;
    }

    deleteChat(chatId: string) {
        const stmt = this.db.prepare("DELETE FROM chats WHERE id = ?");
        stmt.run(chatId);
    }

    saveMessage(chatId: string, message: Message) {
        this.saveMessageStmt.run(message.id, chatId, message.author.username, message.encrypted_data, message.created_at);
        
        for (const msgKey of message.message_keys) {
            this.saveUser(msgKey.user);
            this.saveMessageKeyStmt.run(message.id, msgKey.user.username, msgKey.key);
        }
    }

    getMessage(messageId: string): Message | null {
        const messageRow = this.getMessageStmt.get(messageId) as any;
        if (!messageRow) return null;

        const authorRow = this.getUserStmt.get(messageRow.author) as any;
        if (!authorRow) throw new Error(`Data integrity issue: Author ${messageRow.author} missing.`);
        
        const author = new User(
            new Profile(authorRow.display_name || "", authorRow.profile_image_url || "", authorRow.bio || ""),
            authorRow.username,
            authorRow.public_key,
            []
        );

        const keyRows = this.getMessageKeysStmt.all(messageId) as unknown as any[];
        const messageKeys = keyRows.map(row => {
            const recipientProfile = new Profile(row.display_name || "", row.profile_image_url || "", row.bio || "");
            const recipientUser = new User(recipientProfile, row.username, row.public_key, []);
            return new MessageKey(row.encrypted_key, recipientUser);
        });

        return new Message(
            messageRow.id,
            author,
            messageRow.encrypted_data,
            messageRow.created_at,
            messageKeys
        );
    }

    getChatMessages(chatId: string): Message[] {
        const rows = this.getChatMessagesStmt.all(chatId) as unknown as any[];

        return rows.map(row => {
            const profile = new Profile(row.display_name || "", row.profile_image_url || "", row.bio || "");
            const author = new User(profile, row.username, row.public_key, []);

            const keyRows = this.getMessageKeysStmt.all(row.message_id) as unknown as any[];
            const messageKeys = keyRows.map(kRow => {
                const recProfile = new Profile(kRow.display_name || "", kRow.profile_image_url || "", kRow.bio || "");
                const recUser = new User(recProfile, kRow.username, kRow.public_key, []);
                return new MessageKey(kRow.encrypted_key, recUser);
            });

            return new Message(
                row.message_id, 
                author, 
                row.encrypted_data, 
                row.created_at,
                messageKeys
            );
        });
    }

    deleteMessage(messageId: string) {
        this.deleteMessageStmt.run(messageId);
    }
}