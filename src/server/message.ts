import { User } from "./user";

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
    encrypted_data: string; // after decrypting this is an object containing message_content, reactions, etc etc
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