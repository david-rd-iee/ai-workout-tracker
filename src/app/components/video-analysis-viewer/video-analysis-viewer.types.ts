import { SavedVideoAnalysisRecord } from '../../models/video-analysis.model';

export type VideoAnalysisViewerNote = {
  timestampSeconds: number;
  note: string;
  createdAtIso: string;
};

export type VideoAnalysisViewerDrawing = {
  timestampSeconds: number;
  imageUrl: string;
  storagePath: string;
  createdAtIso: string;
  note: string;
};

export type VideoAnalysisViewerAnalysis = SavedVideoAnalysisRecord & {
  id: string;
  label: string;
  analyzedAtIso: string;
  workoutName: string;
  recordingUrl: string;
  overlayUrl: string;
  notes: VideoAnalysisViewerNote[];
  drawings: VideoAnalysisViewerDrawing[];
};
