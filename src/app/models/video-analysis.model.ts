export type VideoLandmarkName =
  | 'nose'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftElbow'
  | 'rightElbow'
  | 'leftWrist'
  | 'rightWrist'
  | 'leftHip'
  | 'rightHip'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftAnkle'
  | 'rightAnkle';

export interface VideoAnalysisPoint {
  x: number;
  y: number;
  z: number | null;
  visibility: number | null;
}

export interface VideoAnalysisFrame {
  timeMs: number;
  landmarks: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>>;
}

export interface VideoAnalysisSeriesPoint {
  timeMs: number;
  value: number | null;
}

export interface JointRangeSummary {
  minimum: number | null;
  maximum: number | null;
  range: number | null;
}

export interface MotionRangeSummary extends JointRangeSummary {
  signal: string | null;
  label: string | null;
}

export interface DominantMovementSummary {
  signal: string;
  label: string;
  amplitude: number;
}

export interface RepCycleSummary {
  startTimeMs: number;
  peakTimeMs: number;
  endTimeMs: number;
  amplitude: number;
}

export interface RepCountSummary {
  applicable: boolean;
  total: number;
  confidence: 'low' | 'medium' | 'high';
  dominantSignal: string | null;
  dominantSignalLabel: string | null;
  cycles: RepCycleSummary[];
}

export interface TempoSummary {
  applicable: boolean;
  averageRepDurationMs: number | null;
  averageEccentricMs: number | null;
  averageConcentricMs: number | null;
  cadencePerMinute: number | null;
}

export interface SymmetryPairSummary {
  applicable: boolean;
  leftRange: number | null;
  rightRange: number | null;
  averageDifference: number | null;
  rangeDifferencePercent: number | null;
  score: number | null;
}

export interface TrunkLeanSummary {
  applicable: boolean;
  average: number | null;
  maximum: number | null;
  series: VideoAnalysisSeriesPoint[];
}

export interface BackAngleSummary {
  applicable: boolean;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  series: VideoAnalysisSeriesPoint[];
}

export interface KneeValgusSummary {
  applicable: boolean;
  averageRatio: number | null;
  minimumRatio: number | null;
  framesFlagged: number;
  flaggedFramePercentage: number | null;
  series: VideoAnalysisSeriesPoint[];
}

export interface ElbowFlareSummary {
  applicable: boolean;
  leftAverage: number | null;
  rightAverage: number | null;
  leftMaximum: number | null;
  rightMaximum: number | null;
  leftSeries: VideoAnalysisSeriesPoint[];
  rightSeries: VideoAnalysisSeriesPoint[];
}

// ─── Pose data canonical types (CLAUDE.md spec) ─────────────────────────────

export interface PoseConnection {
  from: VideoLandmarkName;
  to: VideoLandmarkName;
}

export interface PoseLandmark {
  name: VideoLandmarkName;
  x: number;
  y: number;
  z?: number | null;
  visibility?: number | null;
}

export interface PoseFrame {
  timestampMs: number;
  frameWidth: number;
  frameHeight: number;
  poseScore?: number | null;
  landmarks: PoseLandmark[];
}

export interface PoseAnalysis {
  model: string;
  frameRate: number;
  connections: PoseConnection[];
  frames: PoseFrame[];
}

// Skeleton connections used for overlay rendering and angle measurement.
// Exported here so both the service and viewer share a single source of truth.
export const POSE_CONNECTIONS: ReadonlyArray<readonly [VideoLandmarkName, VideoLandmarkName]> = [
  ['nose', 'leftShoulder'],
  ['nose', 'rightShoulder'],
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
] as const;

// ─────────────────────────────────────────────────────────────────────────────

export interface VideoAnalysisResult {
  analyzedAtIso: string;
  durationMs: number;
  sampleRateHz: number;
  framesRequested: number;
  framesAnalyzed: number;
  captureWidth?: number;
  captureHeight?: number;
  bodyLandmarks: VideoAnalysisFrame[];
  jointAnglesOverTime: {
    leftElbow: VideoAnalysisSeriesPoint[];
    rightElbow: VideoAnalysisSeriesPoint[];
    leftShoulder: VideoAnalysisSeriesPoint[];
    rightShoulder: VideoAnalysisSeriesPoint[];
    leftHip: VideoAnalysisSeriesPoint[];
    rightHip: VideoAnalysisSeriesPoint[];
    leftKnee: VideoAnalysisSeriesPoint[];
    rightKnee: VideoAnalysisSeriesPoint[];
    trunkLean: VideoAnalysisSeriesPoint[];
    backAngle: VideoAnalysisSeriesPoint[];
  };
  dominantMovement: DominantMovementSummary | null;
  repCount: RepCountSummary;
  tempo: TempoSummary;
  rangeOfMotion: {
    dominant: MotionRangeSummary;
    joints: {
      leftElbow: JointRangeSummary;
      rightElbow: JointRangeSummary;
      leftShoulder: JointRangeSummary;
      rightShoulder: JointRangeSummary;
      leftHip: JointRangeSummary;
      rightHip: JointRangeSummary;
      leftKnee: JointRangeSummary;
      rightKnee: JointRangeSummary;
    };
  };
  symmetry: {
    overallScore: number | null;
    knees: SymmetryPairSummary;
    hips: SymmetryPairSummary;
    elbows: SymmetryPairSummary;
    shoulders: SymmetryPairSummary;
  };
  posture: {
    trunkLean: TrunkLeanSummary;
    kneeValgus: KneeValgusSummary;
    elbowFlare: ElbowFlareSummary;
    backAngle: BackAngleSummary;
  };
}

export interface VideoCompressionResult {
  blob: Blob;
  mimeType: string;
  fileExtension: string;
  sizeBytes: number;
  originalSizeBytes: number;
  compressed: boolean;
  compressionRatio: number;
  width: number;
  height: number;
}

export interface VideoAnalysisPublicationMetadata {
  canView?: boolean;
  publishedToClientAt?: string | null;
  publishedToClientBy?: string | null;
}

export interface SavedVideoAnalysisRecord extends VideoAnalysisPublicationMetadata {
  documentId: string;
  videoStoragePath: string;
  videoDownloadUrl: string;
  overlayVideoStoragePath?: string;
  overlayVideoDownloadUrl?: string;
}
