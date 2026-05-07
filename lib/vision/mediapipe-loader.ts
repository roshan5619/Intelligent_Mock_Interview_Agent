/**
 * MediaPipe Tasks loader — lazy-loads the FaceLandmarker, FaceBlendshapes
 * (built into FaceLandmarker), and PoseLandmarker.
 *
 * Models are fetched once from the official Google CDN at first use; the
 * WASM runtime is hosted there too. We keep singleton instances per-session.
 */
import {
  FaceLandmarker,
  PoseLandmarker,
  FilesetResolver,
} from '@mediapipe/tasks-vision';

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let faceLandmarker: FaceLandmarker | null = null;
let poseLandmarker: PoseLandmarker | null = null;

export async function getFaceLandmarker(): Promise<FaceLandmarker> {
  if (faceLandmarker) return faceLandmarker;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: FACE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true, // gives us emotion-relevant signals
    outputFacialTransformationMatrixes: false,
  });
  return faceLandmarker;
}

export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (poseLandmarker) return poseLandmarker;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  poseLandmarker = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });
  return poseLandmarker;
}

/** Best-effort cleanup. Safe to call from a React effect cleanup. */
export function disposeMediaPipe(): void {
  try {
    faceLandmarker?.close();
  } catch {
    // ignore
  }
  try {
    poseLandmarker?.close();
  } catch {
    // ignore
  }
  faceLandmarker = null;
  poseLandmarker = null;
}
