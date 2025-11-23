import { BaseUserProfile } from "./BaseProfile";

export interface trainerProfile extends BaseUserProfile {
  accountType: "trainer";
  specialization: string;
  experience: string;
  education: string;
  shortDescription?: string;
  description: string;
  certifications?: string[];
  trainingLocation: {
    remote: boolean;
    inPerson: boolean;
  };
  hourlyRate?: number;
  availability?: {
    [key: string]: { start: string; end: string; }[];
  };
  additionalPhotos?: string[];
  introVideoUrl?: string;
  visible?: boolean;
}


