export enum MessageType {
    NONE,

    // General
    ERROR,
    SUCCESS,
    TYPE_NOT_IMPLEMENTED,
    
    // Challenge
    CHALLENGE_REQUEST, // Client to Server
    CHALLENGE_ISSUED, // Server to Client
    CHALLENGE_VERIFY_AND_EXECUTE, // Client to Server

    // User Client to Server
    ACCOUNT_CREATE, 
    ACCOUNT_GET_SETTINGS,
    ACCOUNT_GET_CHATS,
    USER_GET_INFO,
    
    // Chat Client to Server
    CHAT_CREATE,
    CHAT_EDIT,
    CHAT_GET,
    CHAT_GET_PARTICIPANTS_KEYS,
    CHAT_DELETE,

    PARTICIPANT_INVITE, 
    PARTICIPANT_REMOVE, 

    INVITE_ACCEPT, 

    // Chat Server to Client
    CHAT_DELETED,
    CHAT_EDITED,

    PARTICIPANT_INVITED,
    PARTICIPANT_INVITE_ACCEPTED,
    PARTICIPANT_REMOVED,

    // DM Client to Server
    DM_GET,
    DM_GET_PARTICIPANTS_KEYS,
    DM_DELETE,

    // DM Server to Client
    DM_DELETED,

    // Message Client to Server
    MESSAGE_CREATE,
    MESSAGE_EDIT,
    MESSAGE_DELETE,

    // Message Server to Client
    MESSAGE_CREATED,
    MESSAGE_EDITED,
    MESSAGE_DELETED,
}