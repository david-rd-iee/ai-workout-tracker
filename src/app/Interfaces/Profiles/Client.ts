import { BaseUserProfile } from "./BaseProfile";

export interface clientProfile extends BaseUserProfile {
    accountType: "client";
    goals: string;
    experience: string;
    description: string;
  }