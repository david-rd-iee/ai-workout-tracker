import { BaseUserProfile } from "./BaseProfile";

export interface clientProfile extends BaseUserProfile {
    accountType: "client";
    goals: string;
    experience: string;
    description: string;
    displayBadges?: string[]; // Array of badge IDs to display on profile
  }