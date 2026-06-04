import { User } from "./user";

export enum ChatType {
    DM,
    GROUP
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