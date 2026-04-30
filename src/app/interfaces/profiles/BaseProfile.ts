export interface BaseUserProfile {
    id: string;
    displayName?: string;
    firstName: string;
    lastName: string;
    email: string | undefined;
    phone: string;
    profilepic: string;
    city: string;
    state: string;
    zip: number;
    accountType: "trainer" | "client";
    role?: "trainer" | "client";
    demoMode?: boolean;
    fitnessLevel?: string;
    goal?: string;
    trainerId?: string;
    gclid?: string; // Google Ads click ID for conversion tracking
    unreadMessageCount?: number; // Count of unread messages for notification badges
}

export interface AuthProfile {
    uid: string;
    email: string;
    emailVerified: boolean;
    lastLogin: Date;
}
