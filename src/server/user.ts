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

export class User {
    profileInfo: Profile;
    username: string = "";
    publicKey: string = "";

    constructor(profileInfo: Profile, username: string, publicKey: string) {
        this.profileInfo = profileInfo;
        this.username = username;
        this.publicKey = publicKey;
    }
}