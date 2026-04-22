import { SavedVideoAnalysisRecord, VideoAnalysisFrame, VideoAnalysisPoint, VideoLandmarkName } from '../../models/video-analysis.model';

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
  // Unified, normalized pose frames for angle measurement.
  // Populated by the parent page from either inline Firestore data or a fetched artifact.
  poseFrames?: VideoAnalysisFrame[];
  // URL to the body-landmarks JSON artifact for lazy loading when inline data is absent.
  poseArtifactUrl?: string;
};

/**
 * Normalizes raw Firestore analysis data into a flat VideoAnalysisFrame[] that the
 * viewer can consume regardless of whether the data came from the new poseAnalysis
 * structure or the legacy bodyLandmarks format.
 *
 * Priority: new `poseAnalysis` → legacy `bodyLandmarks` → empty array.
 */
export function normalizePoseFrames(
  inlineBodyLandmarks: unknown,
  inlinePoseAnalysis: unknown,
): VideoAnalysisFrame[] {
  // ── New format: poseAnalysis.frames[].{timestampMs, landmarks[].{name,x,y,…}} ──
  if (inlinePoseAnalysis != null && typeof inlinePoseAnalysis === 'object') {
    const pa = inlinePoseAnalysis as Record<string, unknown>;
    if (Array.isArray(pa['frames']) && pa['frames'].length > 0) {
      return (pa['frames'] as unknown[])
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map(f => {
          const rawLandmarks = Array.isArray(f['landmarks']) ? (f['landmarks'] as unknown[]) : [];
          const landmarks: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>> = {};
          for (const lm of rawLandmarks) {
            if (!lm || typeof lm !== 'object') continue;
            const l = lm as Record<string, unknown>;
            const name = l['name'] as VideoLandmarkName | undefined;
            if (!name) continue;
            landmarks[name] = {
              x: typeof l['x'] === 'number' ? l['x'] : 0,
              y: typeof l['y'] === 'number' ? l['y'] : 0,
              z: typeof l['z'] === 'number' ? l['z'] : null,
              visibility: typeof l['visibility'] === 'number' ? l['visibility'] : null,
            };
          }
          return {
            timeMs: typeof f['timestampMs'] === 'number' ? f['timestampMs'] : 0,
            landmarks,
          };
        });
    }
  }

  // ── Legacy format: bodyLandmarks[].{timeMs, landmarks:{name:{x,y,z,visibility}}} ──
  if (Array.isArray(inlineBodyLandmarks) && inlineBodyLandmarks.length > 0) {
    return (inlineBodyLandmarks as unknown[])
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map(f => {
        const rawLandmarks = f['landmarks'];
        const landmarks: Partial<Record<VideoLandmarkName, VideoAnalysisPoint>> = {};
        if (rawLandmarks && typeof rawLandmarks === 'object') {
          for (const [name, point] of Object.entries(rawLandmarks as Record<string, unknown>)) {
            if (!point || typeof point !== 'object') continue;
            const p = point as Record<string, unknown>;
            landmarks[name as VideoLandmarkName] = {
              x: typeof p['x'] === 'number' ? p['x'] : 0,
              y: typeof p['y'] === 'number' ? p['y'] : 0,
              z: typeof p['z'] === 'number' ? p['z'] : null,
              visibility: typeof p['visibility'] === 'number' ? p['visibility'] : null,
            };
          }
        }
        return {
          timeMs: typeof f['timeMs'] === 'number' ? f['timeMs'] : 0,
          landmarks,
        };
      });
  }

  return [];
}
